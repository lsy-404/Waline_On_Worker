import { Hono } from "hono";
import type { Env, Variables } from "../env.js";
import { signJwt } from "../middleware/auth.js";
import { getAvatar, proxyAvatar } from "../utils/avatar.js";
import { md5 } from "../utils/hash.js";
import { verifyPassword } from "../utils/password.js";
import { generateSecret, verifyTotp } from "../utils/totp.js";

export const tokenRoutes = new Hono<{
	Bindings: Env;
	Variables: Variables;
}>();

/**
 * GET /api/token - Get current user info
 */
tokenRoutes.get("/", async (c) => {
	const userInfo = c.get("userInfo");
	if (!userInfo) {
		return c.json({ errno: 1, errmsg: "Unauthorized" }, 401);
	}

	return c.json({
		errno: 0,
		errmsg: "",
		data: {
			objectId: userInfo.objectId,
			display_name: userInfo.display_name,
			email: userInfo.email,
			type: userInfo.type,
			url: userInfo.url,
			avatar: proxyAvatar(
				userInfo.avatar || (await getAvatar(userInfo.email)),
				c.env.AVATAR_PROXY,
			),
			label: userInfo.label || "",
			github: userInfo.github,
			twitter: userInfo.twitter,
			facebook: userInfo.facebook,
			google: userInfo.google,
			weibo: userInfo.weibo,
			qq: userInfo.qq,
			"2fa": userInfo["2fa"] ? true : undefined,
			mailMd5: await md5(userInfo.email.toLowerCase()),
		},
	});
});

/**
 * POST /api/token - Login
 */
tokenRoutes.post("/", async (c) => {
	const body = await c.req.json();
	const { email, password } = body;

	if (!email || !password) {
		return c.json({ errno: 1, errmsg: "email and password are required" }, 400);
	}

	const user = await c.env.DB.prepare("SELECT * FROM wl_Users WHERE email = ?")
		.bind(email)
		.first();

	if (!user) {
		return c.json({ errno: 1, errmsg: "Invalid credentials" }, 401);
	}

	if ((user.type as string) === "banned") {
		return c.json({ errno: 1, errmsg: "Invalid credentials" }, 401);
	}

	const valid = await verifyPassword(password, user.password as string);
	if (!valid) {
		return c.json({ errno: 1, errmsg: "Invalid credentials" }, 401);
	}

	// Check 2FA
	if (user["2fa"]) {
		if (!body.code) {
			return c.json(
				{ errno: 1, errmsg: "2FA required", data: { "2fa": true } },
				401,
			);
		}
		const verified2fa = await verifyTotp(user["2fa"] as string, body.code);
		if (!verified2fa) {
			return c.json(
				{ errno: 1, errmsg: "Two factor auth verify failed, please try again" },
				401,
			);
		}
	}

	const jwtSecret = c.env.JWT_SECRET;
	if (!jwtSecret) {
		return c.json({ errno: 1, errmsg: "JWT_SECRET not configured" }, 500);
	}

	const token = await signJwt({ id: user.id as number }, jwtSecret);

	return c.json({
		errno: 0,
		errmsg: "",
		data: {
			token,
			objectId: user.id,
			display_name: user.display_name,
			email: user.email,
			type: user.type,
			url: user.url || "",
			avatar: proxyAvatar(
				(user.avatar as string) || (await getAvatar(user.email as string)),
				c.env.AVATAR_PROXY,
			),
			label: user.label || "",
			mailMd5: await md5((user.email as string).toLowerCase()),
		},
	});
});

/**
 * DELETE /api/token - Logout
 */
tokenRoutes.delete("/", async (c) => {
	return c.json({ errno: 0, errmsg: "" });
});

/**
 * GET /api/token/2fa - Check 2FA status or get 2FA setup info
 */
tokenRoutes.get("/2fa", async (c) => {
	const userInfo = c.get("userInfo");
	const email = c.req.query("email");

	// Public check: is 2FA enabled for a given email?
	if (!userInfo && email) {
		const user = await c.env.DB.prepare(
			'SELECT "2fa" FROM wl_Users WHERE email = ?',
		)
			.bind(email)
			.first();

		return c.json({
			errno: 0,
			data: { enable: !!user && !!user["2fa"] },
		});
	}

	// Not authenticated and no email param
	if (!userInfo) {
		return c.json({ errno: 0, data: { enable: false } });
	}

	// Authenticated: return 2FA setup info
	const name = `waline_${userInfo.objectId}`;

	if (userInfo["2fa"] && userInfo["2fa"].length === 32) {
		return c.json({
			errno: 0,
			data: {
				otpauth_url: `otpauth://totp/${name}?secret=${userInfo["2fa"]}`,
				secret: userInfo["2fa"],
			},
		});
	}

	// Generate new secret for setup
	const secret = generateSecret(20);
	return c.json({
		errno: 0,
		data: {
			otpauth_url: `otpauth://totp/${name}?secret=${secret}`,
			secret,
		},
	});
});

/**
 * POST /api/token/2fa - Verify and enable 2FA
 */
tokenRoutes.post("/2fa", async (c) => {
	const userInfo = c.get("userInfo");
	if (!userInfo) {
		return c.json({ errno: 1, errmsg: "Unauthorized" }, 401);
	}

	const { secret, code } = await c.req.json();
	if (!secret || !code || !/^\d{6}$/.test(code)) {
		return c.json({ errno: 1, errmsg: "Invalid 2FA code" }, 400);
	}

	const verified = await verifyTotp(secret, code);
	if (!verified) {
		return c.json(
			{ errno: 1, errmsg: "Two factor auth verify failed, please try again" },
			401,
		);
	}

	await c.env.DB.prepare('UPDATE wl_Users SET "2fa" = ? WHERE id = ?')
		.bind(secret, userInfo.objectId)
		.run();

	return c.json({ errno: 0, errmsg: "" });
});
