import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createComment } from "@tests/helpers/factories.js";
import { resetDB } from "@tests/helpers/setup.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@/env.js";
import app from "@/index.js";

const db = (env as Env).DB;

beforeEach(async () => {
	await resetDB(db);
});

async function list(path: string, disableRegion = "true") {
	const ctx = createExecutionContext();
	const response = await app.request(
		`/api/comment?path=${path}`,
		undefined,
		{
			DB: db,
			LEVELS: "0,1,2,3",
			DISABLE_REGION: disableRegion,
		},
		ctx,
	);
	await waitOnExecutionContext(ctx);
	expect(response.status).toBe(200);
	return response.json() as Promise<{ data: { data: any[] } }>;
}

describe("adversarial display configuration", () => {
	it("looks up anonymous levels with a covering mailbox/status index", async () => {
		await createComment(db, { mail: "reader@example.com", url: "/target" });
		await createComment(db, { mail: "reader@example.com", url: "/elsewhere" });
		const preparation = vi.spyOn(db, "prepare");
		let queries: string[];
		try {
			const response = await list("/target");
			expect(response.data.data[0].level).toBe(2);
			queries = preparation.mock.calls.map(([query]) => query);
		} finally {
			preparation.mockRestore();
		}
		const query = queries.find((query) =>
			query.startsWith("SELECT mail AS identity"),
		);
		expect(query).toBeDefined();
		const plan = await db
			.prepare(`EXPLAIN QUERY PLAN ${query}`)
			.bind("reader@example.com")
			.all();
		expect(plan.results.map((row) => row.detail).join("\n")).toContain(
			"USING COVERING INDEX idx_comment_mail_status",
		);
	});

	it("handles over 100 distinct reply authors without losing level metadata", async () => {
		const root = await createComment(db, {
			mail: "root@example.com",
			url: "/large",
		});
		const statements = Array.from({ length: 105 }, (_, index) =>
			db
				.prepare(
					"INSERT INTO wl_Comment (mail, url, rid, pid, status) VALUES (?, '/large', ?, ?, 'approved')",
				)
				.bind(`author-${index}@example.com`, root.id, root.id),
		);
		await db.batch(statements);
		await db
			.prepare(
				"INSERT INTO wl_CommentRegion (comment_id, country, region, city) SELECT id, 'CA', 'Ontario', '' FROM wl_Comment WHERE url = '/large'",
			)
			.run();
		const response = await list("/large", "false");
		expect(response.data.data[0].children).toHaveLength(105);
		for (const child of response.data.data[0].children) {
			expect(child.level).toBe(1);
			expect(child.addr).toBe("CA Ontario");
		}
	});

	it("keeps each author location attached to its comment during concurrent writes", async () => {
		const responses = await Promise.all(
			Array.from({ length: 12 }, async (_, index) => {
				const ctx = createExecutionContext();
				const response = await app.fetch(
					new Request("https://worker.example/api/comment", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							comment: `author-${index}`,
							url: "/concurrent",
						}),
						cf: {
							country: "CA",
							region: `Region-${index}`,
							city: `City-${index}`,
						},
					}),
					{ DB: db },
					ctx,
				);
				await waitOnExecutionContext(ctx);
				expect(response.status).toBe(201);
				return response.json() as Promise<{
					data: { objectId: number; comment: string; addr: string };
				}>;
			}),
		);
		for (const [index, response] of responses.entries()) {
			expect(response.data.comment).toContain(`author-${index}`);
			expect(response.data.addr).toBe(`CA Region-${index}`);
			const stored = await db
				.prepare(
					"SELECT region, city FROM wl_CommentRegion WHERE comment_id = ?",
				)
				.bind(response.data.objectId)
				.first();
			expect(stored).toEqual({
				region: `Region-${index}`,
				city: `City-${index}`,
			});
		}
	});
});
