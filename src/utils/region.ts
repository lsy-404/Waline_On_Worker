export interface CommentRegion {
	country: string;
	region: string;
	city: string;
}

export function parseRegion(value: unknown): CommentRegion | null {
	if (!value || typeof value !== "object") return null;
	const fields = value as Record<string, unknown>;
	const text = (value: unknown) =>
		typeof value === "string" ? value.trim().slice(0, 255) : "";
	const country = text(fields.country).toUpperCase();
	const location = {
		country: /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "",
		region: text(fields.region),
		city: text(fields.city),
	};
	return location.country || location.region || location.city ? location : null;
}

export function formatRegion(
	location: CommentRegion,
	isAdmin: boolean,
): string {
	return [
		...new Set(
			[
				location.country,
				location.region,
				...(isAdmin ? [location.city] : []),
			].filter(Boolean),
		),
	].join(" ");
}

export function insertRegion(
	db: D1Database,
	location: CommentRegion,
): D1PreparedStatement {
	return db
		.prepare(
			"INSERT INTO wl_CommentRegion (comment_id, country, region, city) VALUES (last_insert_rowid(), ?, ?, ?)",
		)
		.bind(location.country, location.region, location.city);
}

export async function getCommentRegions(
	db: D1Database,
	ids: number[],
): Promise<Map<number, CommentRegion>> {
	const locations = new Map<number, CommentRegion>();
	for (let offset = 0; offset < ids.length; offset += 100) {
		const batch = ids.slice(offset, offset + 100);
		const result = await db
			.prepare(
				`SELECT comment_id, country, region, city FROM wl_CommentRegion WHERE comment_id IN (${batch.map(() => "?").join(",")})`,
			)
			.bind(...batch)
			.all<CommentRegion & { comment_id: number }>();
		for (const row of result.results) locations.set(row.comment_id, row);
	}
	return locations;
}
