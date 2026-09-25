import { Hono } from "hono";
import type { Env, Variables } from "../env.js";
import { checkAkismet } from "../utils/akismet.js";
import { getAvatar } from "../utils/avatar.js";
import { reviewComment } from "../utils/llm-review.js";
import { renderMarkdown } from "../utils/markdown.js";
import { parseUA } from "../utils/ua.js";
import { getSettings } from "./settings.js";

export const commentRoutes = new Hono<{
	Bindings: Env;
	Variables: Variables;
}>();

/**
 * GET /api/comment
 * Query params:
 *   - path (required): page path
 *   - page (int, default 1)
 *   - pageSize (int, default 10, max 100)
 *   - sortBy: insertedAt_desc | insertedAt_asc | like_desc
 *   - type: (optional) recent | count | list
 */
commentRoutes.get("/", async (c) => {
	const type = c.req.query("type");

	switch (type) {
		case "recent":
			return getRecentComments(c);
		case "count":
			return getCommentCount(c);
		case "list":
			return getAdminCommentList(c);
		default:
			return getCommentList(c);
	}
});

/**
 * POST /api/comment - Create comment
 */
commentRoutes.post("/", async (c) => {
	const body = await c.req.json();
	const { comment, nick, mail, link, url, ua, pid, rid, at: _at } = body;

	if (!url) {
		return c.json({ errno: 1, errmsg: "url is required" }, 400);
	}
	if (!comment) {
		return c.json({ errno: 1, errmsg: "comment is required" }, 400);
	}

	// Field length limits (D1 row max ~1MB, Workers CPU budget is limited for markdown rendering)
	if (typeof comment !== "string" || comment.length > 65536) {
		return c.json({ errno: 1, errmsg: "comment is too long (max 64KB)" }, 400);
	}
	if (nick && (typeof nick !== "string" || nick.length > 255)) {
		return c.json(
			{ errno: 1, errmsg: "nick is too long (max 255 chars)" },
			400,
		);
	}
	if (mail && (typeof mail !== "string" || mail.length > 255)) {
		return c.json(
			{ errno: 1, errmsg: "mail is too long (max 255 chars)" },
			400,
		);
	}
	if (link && (typeof link !== "string" || link.length > 255)) {
		return c.json(
			{ errno: 1, errmsg: "link is too long (max 255 chars)" },
			400,
		);
	}
	if (url && (typeof url !== "string" || url.length > 1024)) {
		return c.json(
			{ errno: 1, errmsg: "url is too long (max 1024 chars)" },
			400,
		);
	}
	if (ua && (typeof ua !== "string" || ua.length > 1024)) {
		return c.json({ errno: 1, errmsg: "ua is too long (max 1024 chars)" }, 400);
	}

	const ip = c.req.header("CF-Connecting-IP") || "";
	const userInfo = c.get("userInfo");

	// Determine initial status:
	// - comment_default_status setting: anonymous users
	// - user_comment_default_status setting: logged-in users
	// - Fallback: AUDIT env var, then approved
	const statusSettings = await getSettings(c.env.DB, [
		"comment_default_status",
		"user_comment_default_status",
	]).catch(() => ({}) as Record<string, string>);

	let status: string;
	if (userInfo) {
		status =
			statusSettings.user_comment_default_status === "waiting"
				? "waiting"
				: "approved";
	} else {
		const defaultStatus = statusSettings.comment_default_status;
		if (defaultStatus === "waiting" || defaultStatus === "approved") {
			status = defaultStatus;
		} else if (c.env.AUDIT) {
			status = "waiting";
		} else {
			status = "approved";
		}
	}

	// Render markdown to HTML
	const renderedComment = renderMarkdown(comment);

	const result = await c.env.DB.prepare(
		`INSERT INTO wl_Comment (user_id, comment, orig, ip, link, mail, nick, pid, rid, sticky, status, "like", ua, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)`,
	)
		.bind(
			userInfo?.objectId ?? null,
			renderedComment,
			comment,
			ip,
			link || "",
			userInfo?.email || mail || "",
			userInfo?.display_name || nick || "",
			pid || null,
			rid || null,
			status,
			ua || "",
			url,
		)
		.run();

	if (!result.success) {
		return c.json({ errno: 1, errmsg: "Failed to create comment" }, 500);
	}

	const newComment = await c.env.DB.prepare(
		"SELECT * FROM wl_Comment WHERE id = last_insert_rowid()",
	).first();

	// Async spam review (Akismet / LLM / Mix)
	if (newComment) {
		const commentId = (newComment as any).id;
		c.executionCtx.waitUntil(
			runSpamReview({
				db: c.env.DB,
				env: c.env,
				commentId,
				commentText: comment,
				nick: nick || "",
				mail: userInfo?.email || mail || "",
				ip,
				ua: ua || "",
				pageUrl: url,
				userInfo,
				currentStatus: status,
			}).catch((err) =>
				console.error("[Spam Review Error]", err?.message || err),
			),
		);
	}

	return c.json(
		{
			errno: 0,
			errmsg: "",
			data: await formatComment(newComment),
		},
		201,
	);
});

/**
 * PUT /api/comment/:id - Update comment
 */
commentRoutes.put("/:id", async (c) => {
	const id = c.req.param("id");
	const userInfo = c.get("userInfo");
	const body = await c.req.json();
	const isAdmin = userInfo?.type === "administrator";

	// Like action (anyone can like - increment by 1)
	if (body.like !== undefined && typeof body.like === "boolean") {
		await c.env.DB.prepare(
			'UPDATE wl_Comment SET "like" = MAX(0, "like" + 1), updatedAt = datetime(\'now\') WHERE id = ?',
		)
			.bind(id)
			.run();

		const updated = await c.env.DB.prepare(
			"SELECT * FROM wl_Comment WHERE id = ?",
		)
			.bind(id)
			.first();

		return c.json({ errno: 0, errmsg: "", data: await formatComment(updated) });
	}

	// Only admin can update other fields
	if (!isAdmin) {
		return c.json({ errno: 1, errmsg: "Unauthorized" }, 403);
	}

	const updates: string[] = [];
	const values: unknown[] = [];

	if (body.status !== undefined) {
		updates.push("status = ?");
		values.push(body.status);
	}
	if (body.comment !== undefined) {
		updates.push("comment = ?");
		values.push(renderMarkdown(body.comment));
		updates.push("orig = ?");
		values.push(body.comment);
	}
	if (body.sticky !== undefined) {
		updates.push("sticky = ?");
		values.push(body.sticky ? 1 : 0);
	}
	if (body.nick !== undefined) {
		updates.push("nick = ?");
		values.push(body.nick);
	}
	if (body.mail !== undefined) {
		updates.push("mail = ?");
		values.push(body.mail);
	}
	if (body.link !== undefined) {
		updates.push("link = ?");
		values.push(body.link);
	}
	if (body.url !== undefined) {
		updates.push("url = ?");
		values.push(body.url);
	}
	if (body.ua !== undefined) {
		updates.push("ua = ?");
		values.push(body.ua);
	}
	if (body.ip !== undefined) {
		updates.push("ip = ?");
		values.push(body.ip);
	}
	if (body.user_id !== undefined) {
		updates.push("user_id = ?");
		values.push(body.user_id);
	}
	if (body.pid !== undefined) {
		updates.push("pid = ?");
		values.push(body.pid);
	}
	if (body.rid !== undefined) {
		updates.push("rid = ?");
		values.push(body.rid);
	}
	if (typeof body.like === "number") {
		updates.push('"like" = ?');
		values.push(Math.max(0, body.like));
	}

	if (updates.length === 0) {
		return c.json({ errno: 1, errmsg: "No fields to update" }, 400);
	}

	updates.push("updatedAt = datetime('now')");
	values.push(id);

	await c.env.DB.prepare(
		`UPDATE wl_Comment SET ${updates.join(", ")} WHERE id = ?`,
	)
		.bind(...values)
		.run();

	const updated = await c.env.DB.prepare(
		"SELECT * FROM wl_Comment WHERE id = ?",
	)
		.bind(id)
		.first();

	return c.json({ errno: 0, errmsg: "", data: await formatComment(updated) });
});

/**
 * DELETE /api/comment/:id - Delete comment (cascade)
 */
commentRoutes.delete("/:id", async (c) => {
	const id = c.req.param("id");
	const userInfo = c.get("userInfo");

	if (userInfo?.type !== "administrator") {
		return c.json({ errno: 1, errmsg: "Unauthorized" }, 403);
	}

	// Cascade delete: remove child comments
	await c.env.DB.batch([
		c.env.DB.prepare("DELETE FROM wl_Comment WHERE rid = ?").bind(id),
		c.env.DB.prepare("DELETE FROM wl_Comment WHERE id = ?").bind(id),
	]);

	return c.json({ errno: 0, errmsg: "" });
});

/**
 * GET /api/comment/rss - RSS feed for comments
 * Query params:
 *   - path: filter by page path
 *   - email / user_id: get replies to a user's comments
 *   - count: number of items (default 20, max 50)
 */
commentRoutes.get("/rss", async (c) => {
	const path = c.req.query("path");
	const email = c.req.query("email");
	const userId = c.req.query("user_id");
	const count = parseInt(c.req.query("count") || "20", 10);
	const limit = Math.min(Math.max(Number.isFinite(count) ? count : 20, 1), 50);

	const siteUrl = c.env.SITE_URL || "";
	const siteName = c.env.SITE_NAME || "Waline";

	let comments: any[];

	if (path) {
		// Filter by page path
		const result = await c.env.DB.prepare(
			`SELECT id, comment, insertedAt, link, nick, url, user_id FROM wl_Comment
       WHERE url = ? AND status NOT IN ('waiting', 'spam')
       ORDER BY insertedAt DESC LIMIT ?`,
		)
			.bind(path, limit)
			.all();
		comments = result.results;
	} else if (email || userId) {
		// Get replies to a user's comments
		let parentQuery: string;
		const parentParams: string[] = [];

		if (email && userId) {
			parentQuery = `SELECT id FROM wl_Comment WHERE status NOT IN ('waiting', 'spam') AND (mail = ? OR user_id = ?)`;
			parentParams.push(email, userId);
		} else if (email) {
			parentQuery = `SELECT id FROM wl_Comment WHERE status NOT IN ('waiting', 'spam') AND mail = ?`;
			parentParams.push(email);
		} else {
			parentQuery = `SELECT id FROM wl_Comment WHERE status NOT IN ('waiting', 'spam') AND user_id = ?`;
			parentParams.push(userId!);
		}

		const parents = await c.env.DB.prepare(parentQuery)
			.bind(...parentParams)
			.all();
		const parentIds = parents.results.map((r: any) => r.id);

		if (parentIds.length === 0) {
			return rssResponse(
				c,
				buildRssXml({
					title: `${siteName} Reply Comments`,
					link: siteUrl,
					description: "Recent reply comments.",
					items: [],
				}),
			);
		}

		const placeholders = parentIds.map(() => "?").join(",");
		const result = await c.env.DB.prepare(
			`SELECT id, comment, insertedAt, link, nick, url, user_id FROM wl_Comment
       WHERE pid IN (${placeholders}) AND status NOT IN ('waiting', 'spam')
       ORDER BY insertedAt DESC LIMIT ?`,
		)
			.bind(...parentIds, limit)
			.all();
		comments = result.results;
	} else {
		// All recent comments
		const result = await c.env.DB.prepare(
			`SELECT id, comment, insertedAt, link, nick, url, user_id FROM wl_Comment
       WHERE status NOT IN ('waiting', 'spam')
       ORDER BY insertedAt DESC LIMIT ?`,
		)
			.bind(limit)
			.all();
		comments = result.results;
	}

	// Fetch user display names
	const userIds = [
		...new Set(comments.map((r: any) => r.user_id).filter(Boolean)),
	];
	let users: any[] = [];
	if (userIds.length > 0) {
		const placeholders = userIds.map(() => "?").join(",");
		const userResult = await c.env.DB.prepare(
			`SELECT id, display_name, url FROM wl_Users WHERE id IN (${placeholders})`,
		)
			.bind(...userIds)
			.all();
		users = userResult.results;
	}

	// Build RSS items
	const items = comments.map((comment: any) => {
		const user = users.find((u: any) => u.id === comment.user_id);
		const nick = user?.display_name || comment.nick || "Anonymous";
		const commentUrl = buildAbsoluteUrl(siteUrl, comment.url);
		const itemLink = commentUrl ? `${commentUrl}#${comment.id}` : "";

		return {
			title: `${nick} commented${comment.url ? ` on ${comment.url}` : ""}`,
			link: itemLink || commentUrl,
			guid: String(comment.id),
			pubDate: comment.insertedAt
				? new Date(`${comment.insertedAt}Z`).toUTCString()
				: new Date().toUTCString(),
			description: comment.comment || "",
		};
	});

	const title = path
		? `${siteName} Comments for ${path}`
		: email || userId
			? `${siteName} Reply Comments`
			: `${siteName} Recent Comments`;
	const description = path
		? `Recent comments for ${path}.`
		: email || userId
			? "Recent reply comments."
			: "Recent comments.";

	return rssResponse(
		c,
		buildRssXml({ title, link: siteUrl, description, items }),
	);
});

// --- Helper functions ---

async function getCommentList(c: any) {
	const path = c.req.query("path");
	if (!path) {
		return c.json({ errno: 1, errmsg: "path is required" }, 400);
	}

	const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
	const pageSize = Math.min(
		100,
		Math.max(1, parseInt(c.req.query("pageSize") || "10", 10) || 10),
	);
	const sortBy = c.req.query("sortBy") || "insertedAt_desc";

	const orderMap: Record<string, string> = {
		insertedAt_desc: "insertedAt DESC",
		insertedAt_asc: "insertedAt ASC",
		like_desc: '"like" DESC',
	};
	const orderBy = orderMap[sortBy] || "insertedAt DESC";
	const offset = (page - 1) * pageSize;

	// Count total root comments
	const countResult = await c.env.DB.prepare(
		"SELECT COUNT(*) as count FROM wl_Comment WHERE url = ? AND rid IS NULL AND pid IS NULL AND status = 'approved'",
	)
		.bind(path)
		.first();
	const totalCount = (countResult?.count as number) || 0;

	// Get root comments (sticky first)
	const rootComments = await c.env.DB.prepare(
		`SELECT * FROM wl_Comment
     WHERE url = ? AND rid IS NULL AND pid IS NULL AND status = 'approved'
     ORDER BY sticky DESC, ${orderBy}
     LIMIT ? OFFSET ?`,
	)
		.bind(path, pageSize, offset)
		.all();

	// Get child comments for these roots
	const rootIds = rootComments.results.map((r: any) => r.id);
	let children: any[] = [];
	if (rootIds.length > 0) {
		const placeholders = rootIds.map(() => "?").join(",");
		const childResult = await c.env.DB.prepare(
			`SELECT * FROM wl_Comment
       WHERE rid IN (${placeholders}) AND status = 'approved'
       ORDER BY insertedAt ASC`,
		)
			.bind(...rootIds)
			.all();
		children = childResult.results;
	}

	// Pre-fetch all users for roots and children to avoid repeated DB lookups
	const userMap = await fetchCommentUsers(c.env.DB, [
		...rootComments.results,
		...children,
	]);

	// Build threaded structure
	const data = await Promise.all(
		rootComments.results.map(async (root: any) => ({
			...(await formatComment(root, false, userMap)),
			children: await Promise.all(
				children
					.filter((child: any) => child.rid === root.id)
					.map((child: any) => formatComment(child, false, userMap)),
			),
		})),
	);

	return c.json({
		errno: 0,
		errmsg: "",
		data: {
			page,
			pageSize,
			count: totalCount,
			totalPages: Math.ceil(totalCount / pageSize),
			data,
		},
	});
}

async function getRecentComments(c: any) {
	const count = Math.min(
		50,
		Math.max(1, parseInt(c.req.query("count") || "10", 10) || 10),
	);

	const result = await c.env.DB.prepare(
		`SELECT * FROM wl_Comment WHERE status = 'approved'
     ORDER BY insertedAt DESC LIMIT ?`,
	)
		.bind(count)
		.all();

	const userMap = await fetchCommentUsers(c.env.DB, result.results);
	return c.json(
		await Promise.all(
			result.results.map((r: any) => formatComment(r, false, userMap)),
		),
	);
}

async function getCommentCount(c: any) {
	const paths = c.req.queries("path") || c.req.queries("path[]") || [];
	if (paths.length === 0) {
		return c.json({ errno: 0, errmsg: "", data: 0 });
	}

	if (paths.length === 1) {
		const result = await c.env.DB.prepare(
			"SELECT COUNT(*) as count FROM wl_Comment WHERE url = ? AND status = 'approved'",
		)
			.bind(paths[0])
			.first();
		return c.json({
			errno: 0,
			errmsg: "",
			data: [(result?.count as number) || 0],
		});
	}

	const placeholders = paths.map(() => "?").join(",");
	const result = await c.env.DB.prepare(
		`SELECT url, COUNT(*) as count FROM wl_Comment
     WHERE url IN (${placeholders}) AND status = 'approved'
     GROUP BY url`,
	)
		.bind(...paths)
		.all();

	const countMap = Object.fromEntries(
		result.results.map((r: any) => [r.url, r.count]),
	);
	return c.json({
		errno: 0,
		errmsg: "",
		data: paths.map((u: string) => countMap[u] || 0),
	});
}

async function getAdminCommentList(c: any) {
	const userInfo = c.get("userInfo");
	if (userInfo?.type !== "administrator") {
		return c.json({ errno: 1, errmsg: "Unauthorized" }, 403);
	}

	const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
	const pageSize = Math.min(
		100,
		Math.max(1, parseInt(c.req.query("pageSize") || "10", 10) || 10),
	);
	const status = c.req.query("status") || "";
	const keyword = c.req.query("keyword") || "";
	const owner = c.req.query("owner") || "";
	const offset = (page - 1) * pageSize;

	let where = "1=1";
	const params: unknown[] = [];

	if (owner === "mine") {
		where += " AND mail = ?";
		params.push(userInfo.email);
	}
	if (status) {
		where += " AND status = ?";
		params.push(status);
	}
	if (keyword) {
		const escaped = keyword.replace(/[%_\\]/g, "\\$&");
		where += " AND comment LIKE ? ESCAPE '\\'";
		params.push(`%${escaped}%`);
	}

	const countResult = await c.env.DB.prepare(
		`SELECT COUNT(*) as count FROM wl_Comment WHERE ${where}`,
	)
		.bind(...params)
		.first();

	const result = await c.env.DB.prepare(
		`SELECT * FROM wl_Comment WHERE ${where}
     ORDER BY insertedAt DESC LIMIT ? OFFSET ?`,
	)
		.bind(...params, pageSize, offset)
		.all();

	const userMap = await fetchCommentUsers(c.env.DB, result.results);
	return c.json({
		errno: 0,
		errmsg: "",
		data: {
			page,
			pageSize,
			spamCount: 0,
			waitingCount: 0,
			totalPages: Math.ceil(((countResult?.count as number) || 0) / pageSize),
			data: await Promise.all(
				result.results.map((r: any) => formatComment(r, true, userMap)),
			),
		},
	});
}

/**
 * Unified spam review: runs Akismet and/or LLM based on spam_mode setting.
 * Updates comment status in-place; no-ops if mode is off or checks pass.
 */
async function runSpamReview(opts: {
	db: D1Database;
	env: Env;
	commentId: number;
	commentText: string;
	nick: string;
	mail: string;
	ip: string;
	ua: string;
	pageUrl: string;
	userInfo: any;
	currentStatus: string;
}): Promise<void> {
	const {
		db,
		env,
		commentId,
		commentText,
		nick,
		mail,
		ip,
		ua,
		pageUrl,
		userInfo,
		currentStatus,
	} = opts;

	const settings = await getSettings(db, [
		"spam_mode",
		"llm_mode",
		"llm_skip_admin",
		"akismet_key",
		"llm_endpoint",
		"llm_api_key",
		"llm_model",
		"llm_prompt",
	]).catch(() => ({}) as Record<string, string>);

	// Determine effective mode: env SPAM_MODE takes priority over DB setting; DB falls back to old llm_mode
	let mode = env.SPAM_MODE || settings.spam_mode || "";
	if (!mode) {
		const legacy = settings.llm_mode || "off";
		mode = legacy === "off" ? "off" : "llm";
	}

	if (mode === "off") return;

	// Akismet logic: env AKISMET_KEY > DB akismet_key
	const effectiveAkismetKey = env.AKISMET_KEY || settings.akismet_key || "";

	// LLM logic: env > DB
	const skipAdminLlm =
		userInfo?.type === "administrator" &&
		(env.LLM_SKIP_ADMIN || settings.llm_skip_admin) !== "0";

	let isSpam = false;

	if ((mode === "akismet" || mode === "mix") && effectiveAkismetKey) {
		const spamByAkismet = await checkAkismet(
			effectiveAkismetKey,
			env.SITE_URL || "",
			{
				ip,
				ua,
				comment: commentText,
				author: nick,
				email: mail,
				pageUrl,
			},
		);
		if (spamByAkismet) isSpam = true;
	}

	if (!isSpam && (mode === "llm" || mode === "mix") && !skipAdminLlm) {
		// Review comment will read settings again (for now), but we should pass down the env values if available
		// For now we trust that reviewComment reads exactly what it needs from DB,
		// but in a future refactor we should pass all config as an object.
		const newStatus = await reviewComment(
			db,
			env,
			commentText,
			nick,
			pageUrl,
			currentStatus,
		);
		if (newStatus === "spam") isSpam = true;
	}

	if (!isSpam) return;

	await db
		.prepare(
			`UPDATE wl_Comment SET status = 'spam', updatedAt = datetime('now') WHERE id = ? AND status = ?`,
		)
		.bind(commentId, currentStatus)
		.run();
}

/**
 * Internal: helper to fetch users for a list of comments to avoid N+1 queries.
 */
async function fetchCommentUsers(
	db: D1Database,
	rows: any[],
): Promise<Map<number, any>> {
	const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
	const userMap = new Map<number, any>();
	if (userIds.length === 0) return userMap;

	const placeholders = userIds.map(() => "?").join(",");
	const result = await db
		.prepare(
			`SELECT id, display_name, email, type, url, avatar, label FROM wl_Users WHERE id IN (${placeholders})`,
		)
		.bind(...userIds)
		.all();

	for (const user of result.results) {
		userMap.set((user as any).id, user);
	}
	return userMap;
}

async function formatComment(
	row: any,
	isAdmin = false,
	userMap?: Map<number, any>,
) {
	if (!row) return null;
	const user = row.user_id ? userMap?.get(row.user_id) : null;

	const nick = user?.display_name || row.nick || "Anonymous";
	const mail = user?.email || row.mail || "";
	const link = user?.url || row.link || "";

	const { browser, os } = parseUA(row.ua || "");
	const avatar = user?.avatar || (await getAvatar(mail));

	// Gracefully handle null timestamps and ensure standard ISO format.
	// legacy data might have numeric timestamps or strings with space.
	const rawDate = row.insertedAt || row.createdAt;
	let time = 0;
	let isoDate = "";

	if (rawDate) {
		if (typeof rawDate === "number") {
			time = rawDate;
			isoDate = new Date(time).toISOString();
		} else {
			const s = String(rawDate).replace(" ", "T");
			const d = new Date(s.endsWith("Z") || s.includes("T") ? s : `${s}Z`);
			time = d.getTime();
			isoDate = Number.isNaN(time) ? "" : d.toISOString();
		}
	}

	const result: Record<string, any> = {
		objectId: row.id,
		comment: row.comment || "",
		orig: row.orig || row.comment || "",
		nick,
		link,
		avatar,
		browser,
		os,
		time: Number.isNaN(time) ? 0 : time,
		insertedAt: isoDate,
		createdAt: isoDate,
		status: row.status,
		like: row.like ?? 0,
		url: row.url,
		pid: row.pid,
		rid: row.rid,
		sticky: Boolean(row.sticky),
		user_id: row.user_id,
		type: user?.type || (row.user_id ? "guest" : ""),
		label: user?.label || "",
	};

	if (isAdmin) {
		result.mail = mail;
		result.ip = row.ip || "";
		result.ua = row.ua || "";
	}

	return result;
}

// --- RSS helpers ---

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function buildAbsoluteUrl(baseUrl: string, path: string | undefined): string {
	if (!path) return baseUrl || "";
	if (/^(https?:)?\/\//i.test(path)) return path;
	if (!baseUrl) return path;
	const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${normalizedBase}${normalizedPath}`;
}

function buildRssXml({
	title,
	link,
	description,
	items,
}: {
	title: string;
	link: string;
	description: string;
	items: {
		title: string;
		link: string;
		guid: string;
		pubDate: string;
		description: string;
	}[];
}): string {
	const now = new Date().toUTCString();
	const itemsXml = items
		.map(
			(item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid>${escapeXml(item.guid)}</guid>
      <pubDate>${item.pubDate}</pubDate>
      <description><![CDATA[${item.description}]]></description>
    </item>`,
		)
		.join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(link)}</link>
    <description>${escapeXml(description)}</description>
    <pubDate>${now}</pubDate>
${itemsXml}
  </channel>
</rss>`;
}

function rssResponse(c: any, xml: string): Response {
	return c.body(xml, 200, {
		"Content-Type": "application/rss+xml; charset=utf-8",
	});
}
