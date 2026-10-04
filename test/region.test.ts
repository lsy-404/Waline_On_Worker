import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createComment, createUser } from "@tests/helpers/factories.js";
import { resetDB, setupDB } from "@tests/helpers/setup.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@/env.js";
import app from "@/index.js";
import { signJwt } from "@/middleware/auth.js";

const db = (env as Env).DB;
const location = { country: "CA", region: "Ontario", city: "Toronto" };
const readerLocation = { country: "US", region: "Texas", city: "Austin" };
let token: string;

beforeEach(async () => {
	await resetDB(db);
	const admin = await createUser(db, {
		email: "region-admin@example.com",
		type: "administrator",
	});
	token = await signJwt({ id: admin.id }, "region-test");
});

async function request(
	path: string,
	options: {
		method?: string;
		body?: unknown;
		cf?: Record<string, unknown>;
		disabled?: string;
		admin?: boolean;
		headers?: Record<string, string>;
		status?: number;
	} = {},
) {
	const ctx = createExecutionContext();
	const input = new Request(`https://worker.example${path}`, {
		method: options.method || "GET",
		headers: {
			"Content-Type": "application/json",
			...(options.admin ? { Authorization: `Bearer ${token}` } : {}),
			...options.headers,
		},
		...(options.body ? { body: JSON.stringify(options.body) } : {}),
		...(options.cf ? { cf: options.cf } : {}),
	});
	const response = await app.fetch(
		input,
		{
			DB: db,
			JWT_SECRET: "region-test",
			DISABLE_REGION: options.disabled,
		},
		ctx,
	);
	await waitOnExecutionContext(ctx);
	if (options.status) expect(response.status).toBe(options.status);
	else expect(response.ok).toBe(true);
	return response.json() as Promise<{ errno: number; data: any }>;
}

async function post(
	cf: Record<string, unknown> | undefined = location,
	extra: Record<string, unknown> = {},
	disabled?: string,
) {
	return (
		await request("/api/comment", {
			method: "POST",
			cf,
			disabled,
			body: { comment: "Located comment", url: "/region", ...extra },
		})
	).data;
}

async function list(disabled?: string, cf = readerLocation) {
	return (await request("/api/comment?path=/region", { disabled, cf })).data
		.data;
}

describe("Cloudflare comment region", () => {
	it("persists the author location and uses it for root, reply, recent, like and edit responses", async () => {
		const root = await post();
		expect(root.addr).toBe("CA Ontario");
		const child = await post(readerLocation, {
			pid: root.objectId,
			rid: root.objectId,
		});
		expect(child.addr).toBe("US Texas");
		const comments = await list();
		expect(comments[0].addr).toBe("CA Ontario");
		expect(comments[0].children[0].addr).toBe("US Texas");
		const recent = await request("/api/comment?type=recent", {
			cf: readerLocation,
		});
		expect(
			recent.data.find((comment: any) => comment.objectId === root.objectId)
				.addr,
		).toBe("CA Ontario");
		const liked = await request(`/api/comment/${root.objectId}`, {
			method: "PUT",
			body: { like: true },
			cf: readerLocation,
		});
		expect(liked.data.addr).toBe("CA Ontario");
		const edited = await request(`/api/comment/${root.objectId}`, {
			method: "PUT",
			body: { comment: "Edited" },
			admin: true,
			cf: readerLocation,
		});
		expect(edited.data.addr).toBe("CA Ontario");
		const stored = await db
			.prepare(
				"SELECT country, region, city FROM wl_CommentRegion WHERE comment_id = ?",
			)
			.bind(root.objectId)
			.first();
		expect(stored).toEqual(location);
	});

	it("hides region on all public responses while preserving administrator access and later re-enabling", async () => {
		const root = await post(location, {}, "true");
		expect(root).not.toHaveProperty("addr");
		await post(
			readerLocation,
			{ pid: root.objectId, rid: root.objectId },
			"true",
		);
		const comments = await list("true");
		expect(comments[0]).not.toHaveProperty("addr");
		expect(comments[0].children[0]).not.toHaveProperty("addr");
		const recent = await request("/api/comment?type=recent", {
			disabled: "true",
		});
		for (const comment of recent.data)
			expect(comment).not.toHaveProperty("addr");
		const liked = await request(`/api/comment/${root.objectId}`, {
			method: "PUT",
			body: { like: true },
			disabled: "true",
		});
		expect(liked.data).not.toHaveProperty("addr");
		const edited = await request(`/api/comment/${root.objectId}`, {
			method: "PUT",
			body: { comment: "Edited" },
			admin: true,
			disabled: "true",
		});
		expect(edited.data).not.toHaveProperty("addr");
		const admin = await request("/api/comment?type=list", {
			admin: true,
			disabled: "true",
		});
		expect(
			admin.data.data.find((comment: any) => comment.objectId === root.objectId)
				.addr,
		).toBe("CA Ontario Toronto");
		expect((await list("false"))[0].addr).toBe("CA Ontario");
	});

	it.each([
		undefined,
		"",
		"false",
		"FALSE",
		"0",
	])("shows available region when DISABLE_REGION is %s", async (value) => {
		const comment = await post(location, {}, value);
		expect(comment.addr).toBe("CA Ontario");
	});

	it("ignores client-supplied geography and handles missing Cloudflare fields and old comments", async () => {
		const created = await request("/api/comment", {
			method: "POST",
			body: {
				comment: "Spoofed geography",
				url: "/region",
				addr: "Forged",
				cfRegion: location,
				country: "CA",
				region: "Ontario",
				city: "Toronto",
			},
			headers: {
				"CF-IPCountry": "CA",
				"CF-Region": "Ontario",
				"CF-IPCity": "Toronto",
			},
		});
		expect(created.data).not.toHaveProperty("addr");
		await createComment(db, { url: "/region" });
		for (const comment of await list())
			expect(comment).not.toHaveProperty("addr");
		expect(
			(
				await db
					.prepare("SELECT COUNT(*) AS count FROM wl_CommentRegion")
					.first()
			)?.count,
		).toBe(0);
	});

	it.each([
		{ country: "XX" },
		{ country: "T1" },
		{ country: null, region: null, city: null },
		{},
	])("omits unknown location %j", async (cf) => {
		expect(await post(cf)).not.toHaveProperty("addr");
	});

	it("does not expose a city-only location publicly", async () => {
		const comment = await post({ city: "Toronto" });
		expect(comment).not.toHaveProperty("addr");
		const admin = await request("/api/comment?type=list", { admin: true });
		expect(admin.data.data[0].addr).toBe("Toronto");
	});

	it("upgrades an existing database by replaying schema without replacing comments or region rows", async () => {
		await db.prepare("DROP TABLE wl_CommentRegion").run();
		const old = await createComment(db, {
			url: "/region",
			comment: "Existing",
		});
		await setupDB(db);
		expect((await list())[0]).toMatchObject({
			objectId: old.id,
			comment: "Existing",
		});
		expect((await list())[0]).not.toHaveProperty("addr");
		await post();
		await setupDB(db);
		expect(
			(await db.prepare("SELECT COUNT(*) AS count FROM wl_Comment").first())
				?.count,
		).toBe(2);
		expect(
			(
				await db
					.prepare("SELECT COUNT(*) AS count FROM wl_CommentRegion")
					.first()
			)?.count,
		).toBe(1);
	});

	it("exports and imports structured region metadata with the comment backup", async () => {
		await post();
		const exported = await request("/api/db", { admin: true });
		const backup = exported.data.data.Comment[0];
		expect(backup.cfRegion).toEqual(location);
		await request("/api/db?table=Comment", { method: "DELETE", admin: true });
		expect(
			(
				await db
					.prepare("SELECT COUNT(*) AS count FROM wl_CommentRegion")
					.first()
			)?.count,
		).toBe(0);
		const imported = await request("/api/db?table=Comment", {
			method: "POST",
			admin: true,
			body: backup,
		});
		expect(imported.data.objectId).toBeTruthy();
		expect((await list())[0].addr).toBe("CA Ontario");
	});

	it("updates, clears and validates region metadata without altering the comment on failure", async () => {
		const comment = await post();
		const path = `/api/db?table=Comment&objectId=${comment.objectId}`;
		await request(path, {
			method: "PUT",
			admin: true,
			body: { cfRegion: readerLocation },
		});
		expect((await list())[0].addr).toBe("US Texas");
		await request(path, {
			method: "PUT",
			admin: true,
			body: { comment: "Rejected edit", cfRegion: "invalid" },
			status: 400,
		});
		expect((await list())[0].comment).not.toBe("Rejected edit");
		await request(path, {
			method: "PUT",
			admin: true,
			body: { cfRegion: null },
		});
		expect((await list())[0]).not.toHaveProperty("addr");
	});

	it("cascades region deletion for roots and replies", async () => {
		const root = await post();
		await post(readerLocation, { pid: root.objectId, rid: root.objectId });
		await request(`/api/comment/${root.objectId}`, {
			method: "DELETE",
			admin: true,
		});
		expect(
			(await db.prepare("SELECT COUNT(*) AS count FROM wl_Comment").first())
				?.count,
		).toBe(0);
		expect(
			(
				await db
					.prepare("SELECT COUNT(*) AS count FROM wl_CommentRegion")
					.first()
			)?.count,
		).toBe(0);
	});

	it("rolls back comment creation when region persistence fails", async () => {
		await db
			.prepare(
				"CREATE TRIGGER reject_region BEFORE INSERT ON wl_CommentRegion BEGIN SELECT RAISE(ABORT, 'rejected region'); END",
			)
			.run();
		const logging = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await request("/api/comment", {
				method: "POST",
				cf: location,
				body: { comment: "Atomic insert", url: "/region" },
				status: 500,
			});
			expect(
				(await db.prepare("SELECT COUNT(*) AS count FROM wl_Comment").first())
					?.count,
			).toBe(0);
		} finally {
			logging.mockRestore();
			await db.prepare("DROP TRIGGER reject_region").run();
		}
	});
});
