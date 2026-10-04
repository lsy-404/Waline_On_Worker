import { isEnabled } from "./display.js";
import { md5 } from "./hash.js";

export async function getAvatar(email: string): Promise<string> {
	if (!email) return "";
	const hash = await md5(email.trim().toLowerCase());
	return `https://gravatar.com/avatar/${hash}?d=mp`;
}

export function proxyAvatar(avatar: string, proxy?: string): string {
	if (!avatar || !proxy || !isEnabled(proxy)) return avatar;
	try {
		const proxyUrl = new URL(proxy.trim());
		if (proxyUrl.protocol !== "https:" && proxyUrl.protocol !== "http:") {
			return avatar;
		}
		if (avatar.startsWith(`${proxyUrl.origin}${proxyUrl.pathname}?`)) {
			const avatarUrl = new URL(avatar);
			if (avatarUrl.searchParams.has("url")) return avatar;
		}
		proxyUrl.searchParams.set("url", avatar);
		return proxyUrl.toString();
	} catch {
		return avatar;
	}
}
