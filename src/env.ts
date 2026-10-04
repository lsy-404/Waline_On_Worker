export interface Env {
	// D1 Database
	DB: D1Database;

	// Environment variables
	JWT_SECRET?: string;
	SITE_NAME?: string;
	SITE_URL?: string;
	SECURE_DOMAINS?: string;
	DISABLE_USERAGENT?: string;
	DISABLE_AGENT?: string;
	DISABLE_REGION?: string;
	AVATAR_PROXY?: string;
	LEVELS?: string;
	IPQPS?: string;
	AUDIT?: string;

	// SMTP
	SMTP_SERVICE?: string;
	SMTP_HOST?: string;
	SMTP_PORT?: string;
	SMTP_USER?: string;
	SMTP_PASS?: string;
	SENDER_NAME?: string;
	SENDER_EMAIL?: string;

	// OAuth
	OAUTH_URL?: string;

	// Anti-spam
	AKISMET_KEY?: string;
	SPAM_MODE?: string;
	LLM_SKIP_ADMIN?: string;
	LLM_ENDPOINT?: string;
	LLM_API_KEY?: string;
	LLM_MODEL?: string;
	LLM_PROMPT?: string;

	// CAPTCHA
	TURNSTILE_KEY?: string;
	TURNSTILE_SECRET?: string;
	RECAPTCHA_V3_KEY?: string;
	RECAPTCHA_V3_SECRET?: string;
}

export interface UserInfo {
	objectId: number;
	display_name: string;
	email: string;
	type: string;
	url: string;
	avatar: string;
	label?: string;
	github?: string;
	twitter?: string;
	facebook?: string;
	google?: string;
	weibo?: string;
	qq?: string;
	"2fa"?: string;
}

export interface Variables {
	userInfo?: UserInfo;
}
