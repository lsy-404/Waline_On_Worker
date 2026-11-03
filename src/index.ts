import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables } from "./env.js";
import { auth } from "./middleware/auth.js";
import { articleRoutes } from "./router/article.js";
import { commentRoutes } from "./router/comment.js";
import { dbRoutes } from "./router/db.js";
import { oauthRoutes } from "./router/oauth.js";
import { settingsRoutes } from "./router/settings.js";
import { getCurrentUser, tokenRoutes } from "./router/token.js";
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
			const allowed = secureDomains.split(",").map((d: string) => d.trim());
			if (
				allowed.some((d: string) => origin === d || origin.endsWith(`.${d}`))
			) {
				return origin;
			}
			return "";
		},
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		exposeHeaders: ["Content-Length", "x-waline-version"],
		credentials: true,
	}),
);

// Public latency trial: expose only an isolated, read-only test path.
app.use("*", async (c, next) => {
	if (c.env.TRIAL_READ_ONLY === "true") {
		const allowed = c.req.method === "GET" &&
			c.req.path === "/api/comment" &&
			c.req.query("path") === "/__public_trial__";
		if (!allowed) return c.json({ errno: 1, errmsg: "Trial endpoint is read-only" }, 403);
	}
	await next();
});

app.use("*", async (c, next) => {
	if (c.env.DISABLE_REGISTRATION === "true" && c.req.method === "POST" && c.req.path.replace(/\/$/, "") === "/api/user") {
		return c.json({ errno: 1, errmsg: "Registration is disabled" }, 403);
	}
	const path = c.req.path.replace(/\/$/, "");
	const limiter = c.req.method === "POST" && path === "/api/token" ? c.env.LOGIN_LIMITER :
		c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS" ? c.env.WRITE_LIMITER : undefined;
	if (limiter) {
		const ip = c.req.header("CF-Connecting-IP");
		if (!ip) return c.json({ errno: 1, errmsg: "Client address unavailable" }, 403);
		const { success } = await limiter.limit({ key: ip });
		if (!success) return c.json({ errno: 1, errmsg: "Too many requests" }, 429);
	}
	await next();
});

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
// Waline's mobile login callback validates the returned token at /token.
app.get("/token", getCurrentUser);
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
