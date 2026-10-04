import { Hono } from "hono";
import type { Env, Variables } from "../env.js";
import { getAvatar, proxyAvatar } from "../utils/avatar.js";
import { getLevel, parseLevels } from "../utils/display.js";
import { hashPassword } from "../utils/password.js";

export const userRoutes = new Hono<{
	Bindings: Env;
	Variables: Variables;
}>();

/**
 * GET /api/user
 * Get user list
 * Public: top commenters by count
 * Admin: paginated user list
 */
userRoutes.get("/", async (c) => {
	const userInfo = c.get("userInfo");
	const isAdmin = userInfo?.type === "administrator";

	// Admin: lookup user by email (used by import flow)
	const emailQuery = c.req.query("email");
	if (isAdmin && emailQuery) {
		const user = await c.env.DB.prepare(
			"SELECT id, display_name, email, type FROM wl_Users WHERE email = ?",
		)
			.bind(emailQuery)
			.first();
		if (user) {
			return c.json({
				errno: 0,
				objectId: String((user as any).id),
				...(user as any),
			});
		}
		return c.json({ errno: 0 });
	}

	if (isAdmin) {
		const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
		const pageSize = Math.min(
			100,
			Math.max(1, parseInt(c.req.query("pageSize") || "10", 10) || 10),
		);
		const offset = (page - 1) * pageSize;

		const countResult = await c.env.DB.prepare(
			"SELECT COUNT(*) as count FROM wl_Users",
		).first();
		const total = (countResult?.count as number) || 0;

		const result = await c.env.DB.prepare(
			"SELECT id, display_name, email, type, url, avatar, label, createdAt FROM wl_Users ORDER BY createdAt DESC LIMIT ? OFFSET ?",
		)
			.bind(pageSize, offset)
			.all();

		return c.json({
			errno: 0,
			errmsg: "",
			data: {
				page,
				pageSize,
				totalPages: Math.ceil(total / pageSize),
				data: await Promise.all(
					result.results.map((u: any) => formatUser(u, c.env)),
				),
			},
		});
	}

	// Public: top commenters
	const count = Math.min(
		50,
		Math.max(1, parseInt(c.req.query("count") || "10", 10) || 10),
	);
	const result = await c.env.DB.prepare(
		`SELECT u.id, u.display_name, u.email, u.url, u.avatar, u.label,
            COUNT(c.id) as comment_count
     FROM wl_Users u
     LEFT JOIN wl_Comment c ON c.user_id = u.id AND c.status = 'approved'
     GROUP BY u.id
     ORDER BY comment_count DESC
     LIMIT ?`,
	)
		.bind(count)
		.all();

	const levels = parseLevels(c.env.LEVELS);
	return c.json({
		errno: 0,
		errmsg: "",
		data: await Promise.all(
			result.results.map(async (u: any) => ({
				objectId: u.id,
				display_name: u.display_name,
				url: u.url || "",
				avatar: proxyAvatar(
					u.avatar || (await getAvatar(u.email || "")),
					c.env.AVATAR_PROXY,
				),
				label: u.label || "",
				count: u.comment_count,
				...(levels ? { level: getLevel(u.comment_count, levels) } : {}),
			})),
		),
	});
});

/**
 * POST /api/user - Register
 */
userRoutes.post("/", async (c) => {
	const body = await c.req.json();
	const { display_name, email, password, url } = body;

	if (!email || !password) {
		return c.json({ errno: 1, errmsg: "email and password are required" }, 400);
	}

	// Check if email exists
	const existing = await c.env.DB.prepare(
		"SELECT id FROM wl_Users WHERE email = ?",
	)
		.bind(email)
		.first();

	if (existing) {
		return c.json({ errno: 1, errmsg: "Registration failed" }, 409);
	}

	// Check if first user (becomes admin)
	const userCount = await c.env.DB.prepare(
		"SELECT COUNT(*) as count FROM wl_Users",
	).first();
	const isFirst = ((userCount?.count as number) || 0) === 0;

	const hashedPassword = await hashPassword(password);

	await c.env.DB.prepare(
		`INSERT INTO wl_Users (display_name, email, password, type, url)
     VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(
			display_name || email.split("@")[0],
			email,
			hashedPassword,
			isFirst ? "administrator" : "guest",
			url || "",
		)
		.run();

	const newUser = await c.env.DB.prepare(
		"SELECT id, display_name, email, type, url, avatar FROM wl_Users WHERE email = ?",
	)
		.bind(email)
		.first();

	return c.json(
		{
			errno: 0,
			errmsg: "",
			data: await formatUser(newUser, c.env),
		},
		201,
	);
});

/**
 * PUT /api/user/:id - Update user profile
 */
userRoutes.put("/:id", async (c) => {
	const id = c.req.param("id");
	const userInfo = c.get("userInfo");

	if (!userInfo) {
		return c.json({ errno: 1, errmsg: "Unauthorized" }, 401);
	}

	const isAdmin = userInfo.type === "administrator";
	const isSelf = userInfo.objectId === parseInt(id, 10);

	if (!isAdmin && !isSelf) {
		return c.json({ errno: 1, errmsg: "Forbidden" }, 403);
	}

	const body = await c.req.json();
	const updates: string[] = [];
	const values: unknown[] = [];

	const allowedFields = ["display_name", "url", "avatar", "label"];
	for (const field of allowedFields) {
		if (body[field] !== undefined) {
			updates.push(`${field} = ?`);
			values.push(body[field]);
		}
	}

	if (body.password) {
		updates.push("password = ?");
		values.push(await hashPassword(body.password));
	}

	// Admin-only fields
	if (isAdmin && body.type !== undefined) {
		updates.push("type = ?");
		values.push(body.type);
	}

	if (updates.length === 0) {
		return c.json({ errno: 1, errmsg: "No fields to update" }, 400);
	}

	updates.push("updatedAt = datetime('now')");
	values.push(id);

	await c.env.DB.prepare(
		`UPDATE wl_Users SET ${updates.join(", ")} WHERE id = ?`,
	)
		.bind(...values)
		.run();

	const updated = await c.env.DB.prepare(
		"SELECT id, display_name, email, type, url, avatar, label FROM wl_Users WHERE id = ?",
	)
		.bind(id)
		.first();

	return c.json({
		errno: 0,
		errmsg: "",
		data: await formatUser(updated, c.env),
	});
});

/**
 * DELETE /api/user/:id - Delete/ban user
 */
userRoutes.delete("/:id", async (c) => {
	const id = c.req.param("id");
	const userInfo = c.get("userInfo");

	if (userInfo?.type !== "administrator") {
		return c.json({ errno: 1, errmsg: "Unauthorized" }, 403);
	}

	// Ban verified users, delete unverified
	const target = await c.env.DB.prepare(
		"SELECT type FROM wl_Users WHERE id = ?",
	)
		.bind(id)
		.first();

	if (!target) {
		return c.json({ errno: 1, errmsg: "User not found" }, 404);
	}

	if (
		(target.type as string).startsWith("verify:") ||
		target.type === "guest"
	) {
		// Unverified or guest: hard delete
		await c.env.DB.prepare("DELETE FROM wl_Users WHERE id = ?").bind(id).run();
	} else {
		// Verified: ban
		await c.env.DB.prepare(
			"UPDATE wl_Users SET type = 'banned', updatedAt = datetime('now') WHERE id = ?",
		)
			.bind(id)
			.run();
	}

	return c.json({ errno: 0, errmsg: "" });
});

async function formatUser(row: any, env: Env) {
	if (!row) return null;
	return {
		objectId: row.id,
		display_name: row.display_name || "",
		email: row.email || "",
		type: row.type || "guest",
		url: row.url || "",
		avatar: proxyAvatar(
			row.avatar || (await getAvatar(row.email || "")),
			env.AVATAR_PROXY,
		),
		label: row.label || "",
	};
}
