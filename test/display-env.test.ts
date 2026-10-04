import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createComment, createUser } from "@tests/helpers/factories.js";
import { resetDB } from "@tests/helpers/setup.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "@/env.js";
import app from "@/index.js";
import { signJwt } from "@/middleware/auth.js";
import { proxyAvatar } from "@/utils/avatar.js";
import { getLevel, parseLevels } from "@/utils/display.js";

const db = (env as Env).DB;
const ua =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36";
const proxy = "https://proxy.example/avatar?size=80";
const customAvatar = "https://images.example/face.png?size=40&v=2";
let admin: { id: number };
let token: string;

beforeEach(async () => {
	await resetDB(db);
	admin = await createUser(db, {
		email: "admin@example.com",
		password: "password123",
		type: "administrator",
		avatar: customAvatar,
	});
	token = await signJwt({ id: admin.id }, "display-test");
});

async function request(
	path: string,
	overrides: Partial<Env> = {},
	options: { method?: string; body?: unknown; authenticated?: boolean } = {},
) {
	const ctx = createExecutionContext();
	const response = await app.request(
		path,
		{
			method: options.method || "GET",
			headers: {
				"Content-Type": "application/json",
				...(options.authenticated ? { Authorization: `Bearer ${token}` } : {}),
			},
			...(options.body ? { body: JSON.stringify(options.body) } : {}),
		},
		{ DB: db, JWT_SECRET: "display-test", ...overrides },
		ctx,
	);
	await waitOnExecutionContext(ctx);
	expect(response.ok).toBe(true);
	return response.json() as Promise<{ data: any }>;
}

async function seedThread() {
	const root = await createComment(db, {
		mail: "reader@example.com",
		url: "/page",
	});
	const child = await createComment(db, {
		mail: "reader@example.com",
		url: "/page",
		rid: root.id,
		pid: root.id,
	});
	await db.prepare("UPDATE wl_Comment SET ua = ?").bind(ua).run();
	return { root, child };
}

function expectHidden(comment: Record<string, unknown>) {
	expect(comment).not.toHaveProperty("browser");
	expect(comment).not.toHaveProperty("os");
}

function expectProxy(avatar: string, original?: string) {
	const url = new URL(avatar);
	expect(url.origin).toBe("https://proxy.example");
	expect(url.pathname).toBe("/avatar");
	expect(url.searchParams.get("size")).toBe("80");
	if (original) expect(url.searchParams.get("url")).toBe(original);
	else
		expect(url.searchParams.get("url")).toMatch(
			/^https:\/\/gravatar.com\/avatar\//,
		);
}

describe("display flags through Workers/D1 responses", () => {
	it("hides UA fields on roots, replies, recent, create, like and admin edit/list", async () => {
		const { root } = await seedThread();
		const settings = { DISABLE_USERAGENT: "true" };
		const list = await request("/api/comment?path=/page", settings);
		expectHidden(list.data.data[0]);
		expectHidden(list.data.data[0].children[0]);
		const recent = await request("/api/comment?type=recent", settings);
		recent.data.forEach(expectHidden);
		const created = await request("/api/comment", settings, {
			method: "POST",
			body: { comment: "New", url: "/page", ua },
		});
		expectHidden(created.data);
		const liked = await request(`/api/comment/${root.id}`, settings, {
			method: "PUT",
			body: { like: true },
		});
		expectHidden(liked.data);
		const edited = await request(`/api/comment/${root.id}`, settings, {
			method: "PUT",
			body: { comment: "Edited" },
			authenticated: true,
		});
		expectHidden(edited.data);
		const adminList = await request("/api/comment?type=list", settings, {
			authenticated: true,
		});
		const row = adminList.data.data.find(
			(comment: any) => comment.objectId === root.id,
		);
		expectHidden(row);
		expect(row.ua).toBe(ua);
	});

	it.each([
		undefined,
		"",
		"false",
		"FALSE",
		"0",
		" false ",
	])("retains UA when official flag is %s", async (value) => {
		await seedThread();
		const body = await request("/api/comment?path=/page", {
			DISABLE_USERAGENT: value,
		});
		expect(body.data.data[0]).toMatchObject({
			browser: "Chrome 126.0.0.0",
			os: "Windows 10",
		});
	});

	it("supports DISABLE_AGENT and gives an explicit official flag priority", async () => {
		await seedThread();
		const alias = await request("/api/comment?path=/page", {
			DISABLE_AGENT: "true",
		});
		expectHidden(alias.data.data[0]);
		const explicit = await request("/api/comment?path=/page", {
			DISABLE_AGENT: "true",
			DISABLE_USERAGENT: "false",
		});
		expect(explicit.data.data[0].os).toBe("Windows 10");
	});

	it.each([
		undefined,
		"false",
		"true",
	])("never exposes region or IP publicly when DISABLE_REGION is %s", async (value) => {
		await seedThread();
		const body = await request("/api/comment?path=/page", {
			DISABLE_REGION: value,
		});
		expect(body.data.data[0]).not.toHaveProperty("addr");
		expect(body.data.data[0]).not.toHaveProperty("ip");
	});
});

describe("avatar proxy through Workers/D1 responses", () => {
	it("proxies custom and Gravatar avatars on comment lists, replies, recent and mutations", async () => {
		const { root } = await seedThread();
		await createComment(db, { user_id: admin.id, url: "/page" });
		const settings = { AVATAR_PROXY: proxy };
		const list = await request("/api/comment?path=/page", settings);
		for (const comment of list.data.data) {
			expectProxy(comment.avatar, comment.user_id ? customAvatar : undefined);
			for (const child of comment.children) expectProxy(child.avatar);
		}
		const recent = await request("/api/comment?type=recent", settings);
		for (const comment of recent.data)
			expectProxy(comment.avatar, comment.user_id ? customAvatar : undefined);
		const created = await request("/api/comment", settings, {
			method: "POST",
			authenticated: true,
			body: { comment: "By admin", url: "/page" },
		});
		expectProxy(created.data.avatar, customAvatar);
		const liked = await request(`/api/comment/${root.id}`, settings, {
			method: "PUT",
			body: { like: true },
		});
		expectProxy(liked.data.avatar);
		const adminList = await request("/api/comment?type=list", settings, {
			authenticated: true,
		});
		adminList.data.data.forEach((comment: any) => {
			expectProxy(comment.avatar, comment.user_id ? customAvatar : undefined);
		});
	});

	it("applies the proxy to user lists, registration, profile updates, login and current session", async () => {
		const settings = { AVATAR_PROXY: proxy };
		const users = await request("/api/user", settings);
		expectProxy(users.data[0].avatar, customAvatar);
		const adminUsers = await request("/api/user", settings, {
			authenticated: true,
		});
		expectProxy(adminUsers.data.data[0].avatar, customAvatar);
		const registered = await request("/api/user", settings, {
			method: "POST",
			body: { email: "new@example.com", password: "password123" },
		});
		expectProxy(registered.data.avatar);
		const updated = await request(`/api/user/${admin.id}`, settings, {
			method: "PUT",
			authenticated: true,
			body: { avatar: customAvatar },
		});
		expectProxy(updated.data.avatar, customAvatar);
		const login = await request("/api/token", settings, {
			method: "POST",
			body: { email: "admin@example.com", password: "password123" },
		});
		expectProxy(login.data.avatar, customAvatar);
		const current = await request("/api/token", settings, {
			authenticated: true,
		});
		expectProxy(current.data.avatar, customAvatar);
	});

	it.each([
		undefined,
		"",
		"false",
		"FALSE",
		"0",
		"invalid",
		"javascript:alert(1)",
	])("keeps direct avatars for %s", async (value) => {
		const users = await request("/api/user", { AVATAR_PROXY: value });
		expect(users.data[0].avatar).toBe(customAvatar);
	});

	it("does not proxy an already proxied avatar twice", async () => {
		const avatar = proxyAvatar(customAvatar, proxy);
		await db
			.prepare("UPDATE wl_Users SET avatar = ? WHERE id = ?")
			.bind(avatar, admin.id)
			.run();
		const users = await request("/api/user", { AVATAR_PROXY: proxy });
		expect(users.data[0].avatar).toBe(avatar);
	});
});

describe("comment levels through Workers/D1 responses", () => {
	it("counts approved comments across pages and replies, with exact threshold boundaries", async () => {
		const { root } = await seedThread();
		await createComment(db, {
			mail: "reader@example.com",
			url: "/another-page",
		});
		await createComment(db, { mail: "reader@example.com", status: "waiting" });
		await createComment(db, { mail: "reader@example.com", status: "spam" });
		await createComment(db, { mail: "other@example.com", url: "/page" });
		const settings = { LEVELS: "0,2,3,5" };
		const list = await request("/api/comment?path=/page", settings);
		const row = list.data.data.find(
			(comment: any) => comment.objectId === root.id,
		);
		expect(row.level).toBe(2);
		expect(row.children[0].level).toBe(2);
		expect(
			list.data.data.find(
				(comment: any) => comment.nick && comment.objectId !== root.id,
			).level,
		).toBe(0);
		const recent = await request("/api/comment?type=recent", settings);
		expect(
			recent.data.find((comment: any) => comment.objectId === root.id).level,
		).toBe(2);
		const created = await request("/api/comment", settings, {
			method: "POST",
			body: {
				comment: "Fourth",
				url: "/page",
				mail: "reader@example.com",
			},
		});
		expect(created.data.level).toBe(2);
		const liked = await request(`/api/comment/${root.id}`, settings, {
			method: "PUT",
			body: { like: true },
		});
		expect(liked.data.level).toBe(2);
		const adminList = await request("/api/comment?type=list", settings, {
			authenticated: true,
		});
		expect(
			adminList.data.data.find((comment: any) => comment.objectId === root.id)
				.level,
		).toBe(2);
	});

	it("uses registered user identity even when stored email changes and exposes leaderboard levels", async () => {
		await createComment(db, {
			user_id: admin.id,
			mail: "old@example.com",
			url: "/page",
		});
		await createComment(db, {
			user_id: admin.id,
			mail: "new@example.com",
			url: "/another-page",
		});
		await createComment(db, { user_id: admin.id, status: "spam" });
		const settings = { LEVELS: "0,2,3" };
		const list = await request("/api/comment?path=/page", settings);
		expect(list.data.data[0].level).toBe(1);
		const users = await request("/api/user", settings);
		expect(users.data[0]).toMatchObject({ count: 2, level: 1 });
	});

	it("keeps unrelated anonymous comments without email at level zero", async () => {
		await createComment(db, { mail: "", url: "/page" });
		await createComment(db, { mail: "", url: "/page" });
		const body = await request("/api/comment?path=/page", { LEVELS: "0,1,2" });
		body.data.data.forEach((comment: any) => {
			expect(comment.level).toBe(0);
		});
	});

	it.each([
		undefined,
		"",
		"false",
		"FALSE",
		"0",
		"0,bad",
		"0,2,2",
		"0,3,2",
		"0,-1",
		"0,1.5",
		"0,,2",
	])("omits levels for %s", async (value) => {
		await seedThread();
		const body = await request("/api/comment?path=/page", { LEVELS: value });
		expect(body.data.data[0]).not.toHaveProperty("level");
		const users = await request("/api/user", { LEVELS: value });
		expect(users.data[0]).not.toHaveProperty("level");
	});

	it("matches the six documented threshold labels at their boundaries", () => {
		const thresholds = parseLevels(" 0, 10, 20, 50, 100, 200 ") ?? [];
		expect(
			[0, 9, 10, 19, 20, 49, 50, 99, 100, 199, 200].map((count) =>
				getLevel(count, thresholds),
			),
		).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
	});
});
