import { Hono } from "hono";
import type { Env, Variables } from "../env.js";

export const articleRoutes = new Hono<{
	Bindings: Env;
	Variables: Variables;
}>();

// Valid counter fields to prevent SQL injection
const VALID_FIELDS = new Set([
	"time",
	"reaction0",
	"reaction1",
	"reaction2",
	"reaction3",
	"reaction4",
	"reaction5",
	"reaction6",
	"reaction7",
	"reaction8",
]);

/**
 * GET /api/article
 * Query params:
 *   - path / path[] (required): page path(s)
 *   - type / type[] (optional, default: ['time']): counter field(s)
 *
 * Response (follows Waline /api/ format):
 *   - single path: [{[type]: count}]
 *   - multiple paths: [{[type]: count}, …]
 */
articleRoutes.get("/", async (c) => {
	const paths = c.req.queries("path") || c.req.queries("path[]") || [];
	if (paths.length === 0) {
		return c.json({ errno: 0, errmsg: "", data: 0 });
	}

	const types = c.req.queries("type") || c.req.queries("type[]") || ["time"];
	const validTypes = types.filter((t) => VALID_FIELDS.has(t));
	if (validTypes.length === 0) {
		return c.json({ errno: 0, errmsg: "", data: paths.map(() => ({})) });
	}

	const placeholders = paths.map(() => "?").join(",");
	const result = await c.env.DB.prepare(
		`SELECT * FROM wl_Counter WHERE url IN (${placeholders})`,
	)
		.bind(...paths)
		.all();

	const respObj: Record<string, any> = {};
	for (const row of result.results) {
		respObj[(row as any).url] = row;
	}

	const data = paths.map((url) => {
		const counters: Record<string, number> = {};
		for (const field of validTypes) {
			counters[field] = (respObj[url] as any)?.[field] || 0;
		}
		return counters;
	});

	return c.json({ errno: 0, errmsg: "", data });
});

/**
 * POST /api/article
 * Body: { path, type, action }
 *   - path: page path (maps to DB url column)
 *   - type: counter field (e.g. 'time', 'reaction0')
 *   - action: 'inc' | 'desc'
 */
articleRoutes.post("/", async (c) => {
	const body = await c.req.json();
	const { path, type = "time", action = "inc" } = body;

	if (!path) {
		return c.json({ errno: 1, errmsg: "path is required" }, 400);
	}

	if (!VALID_FIELDS.has(type)) {
		return c.json({ errno: 1, errmsg: "invalid type" }, 400);
	}
	if ((action !== "inc" && action !== "desc") || (type === "time" && action !== "inc")) {
		return c.json({ errno: 1, errmsg: "invalid action" }, 400);
	}
	const delta = action === "desc" ? -1 : 1;
	const result = await c.env.DB.prepare(
		`INSERT INTO wl_Counter (url, ${type}) VALUES (?, max(0, ?))
		 ON CONFLICT(url) DO UPDATE SET ${type} = max(0, ${type} + ?), updatedAt = datetime('now')
		 RETURNING ${type}`,
	).bind(path, delta, delta).first();
	return c.json({ errno: 0, errmsg: "", data: [{ [type]: result?.[type] ?? 0 }] });
});
