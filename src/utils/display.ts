export function isEnabled(value?: string): boolean {
	const normalized = value?.trim().toLowerCase();
	return Boolean(normalized && normalized !== "false" && normalized !== "0");
}

export function parseLevels(value?: string): number[] | undefined {
	if (!value || !isEnabled(value)) return undefined;
	const parts = value.split(",").map((part) => part.trim());
	if (parts.some((part) => !/^\d+$/.test(part))) return undefined;
	const levels = parts.map(Number);
	if (
		levels.some(
			(level, index) =>
				!Number.isSafeInteger(level) ||
				(index > 0 && level <= levels[index - 1]),
		)
	) {
		return undefined;
	}
	return levels;
}

export function getLevel(count: number, levels: number[]): number {
	return Math.max(
		0,
		levels.findLastIndex((threshold) => count >= threshold),
	);
}
