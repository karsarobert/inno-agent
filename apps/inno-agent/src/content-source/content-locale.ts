export const CONTENT_LOCALES = ["zh-CN", "en", "hu"] as const;

export type ContentLocale = (typeof CONTENT_LOCALES)[number];

export interface ResolvedContentLocale {
	locale: ContentLocale;
	fallback: boolean;
}

export function normalizeContentLocale(value: unknown): ContentLocale | null {
	return typeof value === "string" && (CONTENT_LOCALES as readonly string[]).includes(value)
		? value as ContentLocale
		: null;
}

export function resolveContentLocale(
	requested: unknown,
	available: readonly ContentLocale[],
): ResolvedContentLocale | null {
	if (available.length === 0) return null;
	const normalized = normalizeContentLocale(requested);
	if (normalized && available.includes(normalized)) return { locale: normalized, fallback: false };

	for (const fallback of ["en", "zh-CN"] as const) {
		if (available.includes(fallback)) return { locale: fallback, fallback: true };
	}
	return { locale: available[0], fallback: true };
}
