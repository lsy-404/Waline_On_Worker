import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables } from "./env.js";
import { auth } from "./middleware/auth.js";
import { articleRoutes } from "./router/article.js";
import { commentRoutes } from "./router/comment.js";
import { dbRoutes } from "./router/db.js";
import { oauthRoutes } from "./router/oauth.js";
import { settingsRoutes } from "./router/settings.js";
import { tokenRoutes } from "./router/token.js";
import { userRoutes } from "./router/user.js";
import { getAdminPage } from "./ui/admin-panel.js";
import { getCustomSettingsPage } from "./ui/custom-admin.js";
import { getWalinePage } from "./ui/waline-page.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS
app.use(
	"*",
	cors({
		origin: (origin, c) => {
			const secureDomains = c.env.SECURE_DOMAINS;
			if (!secureDomains) return origin;
			if (!origin) return "";
			let host: string;
			let hostname: string;
			try {
				const url = new URL(origin);
				host = url.host;
				hostname = url.hostname;
			} catch {
				return "";
			}
			const allowed = secureDomains.split(",").map((d: string) => d.trim());
			const matched = allowed.some((d: string) =>
				d.includes(":") ? host === d : hostname === d || hostname.endsWith(`.${d}`),
			);
			return matched ? origin : "";
		},
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		exposeHeaders: ["Content-Length", "x-waline-version"],
		credentials: true,
	}),
);

// Waline version header (used by admin panel for export __version field)
app.use("*", async (c, next) => {
	await next();
	c.header("x-waline-version", "1.1.0");
});

// Auth middleware - parse JWT on all routes (non-blocking, skips if no token)
app.use("*", auth);

// Global error handler (catches malformed JSON bodies, etc.)
app.onError((err, c) => {
	if (err instanceof SyntaxError) {
		return c.json({ errno: 1, errmsg: "Invalid JSON body" }, 400);
	}
	console.error("[Unhandled Error]", err?.message || err);
	return c.json({ errno: 1, errmsg: "Internal Server Error" }, 500);
});

// Routes
app.route("/api/comment", commentRoutes);
app.route("/api/article", articleRoutes);
app.route("/api/user", userRoutes);
app.route("/api/token", tokenRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/oauth", oauthRoutes);
app.route("/api/db", dbRoutes);

// Worker custom settings page — auth is enforced client-side so direct URL access works
app.get("/ui/worker-setting", async (c) => {
	return c.html(getCustomSettingsPage(c.req.url));
});

// Admin panel UI (original @waline/admin from CDN)
app.get("/ui", async (c) => {
	return c.html(await getAdminPage(c.env, c.req.url));
});
app.get("/ui/*", async (c) => {
	return c.html(await getAdminPage(c.env, c.req.url));
});

// Waline frontend UI (root page)
app.get("/", (c) => {
	return c.html(getWalinePage());
});

export default app;
