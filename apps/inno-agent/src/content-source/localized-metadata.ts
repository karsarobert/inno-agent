import { normalizeContentLocale, resolveContentLocale, type ContentLocale } from "./content-locale.js";

export interface ContentDisplayMetadata {
	id: string;
	name: string;
	description: string;
	category?: string;
	icon?: string;
}

export interface LocalizedDisplayMetadata {
	name?: unknown;
	description?: unknown;
	category?: unknown;
}

export interface ContentLocalizationDocument {
	schemaVersion?: unknown;
	locales?: Record<string, LocalizedDisplayMetadata | undefined>;
}

export interface LocalizedContentMetadataResult {
	metadata: ContentDisplayMetadata;
	locale: ContentLocale | null;
	fallback: boolean;
}

export function parseContentLocalizationDocument(raw: string | null | undefined): ContentLocalizationDocument | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as unknown;
		if (!value || typeof value !== "object") return null;
		const locales = (value as { locales?: unknown }).locales;
		return locales && typeof locales === "object" && !Array.isArray(locales)
			? value as ContentLocalizationDocument
			: null;
	} catch {
		return null;
	}
}

function validLocalizedMetadata(value: LocalizedDisplayMetadata | undefined): value is Required<Pick<LocalizedDisplayMetadata, "name">> & LocalizedDisplayMetadata {
	return typeof value?.name === "string" && value.name.trim().length > 0;
}

export function localizeContentMetadata(
	canonical: ContentDisplayMetadata,
	document: ContentLocalizationDocument | null | undefined,
	requestedLocale: unknown,
): LocalizedContentMetadataResult {
	const entries = document?.locales ?? {};
	const available = Object.keys(entries)
		.map(normalizeContentLocale)
		.filter((locale): locale is ContentLocale => locale !== null)
		.filter((locale) => validLocalizedMetadata(entries[locale]));
	const resolved = resolveContentLocale(requestedLocale, available);
	if (!resolved) return { metadata: canonical, locale: null, fallback: true };

	const localized = entries[resolved.locale]!;
	return {
		metadata: {
			...canonical,
			name: (localized.name as string).trim(),
			description: typeof localized.description === "string" ? localized.description.trim() : canonical.description,
			category: typeof localized.category === "string" && localized.category.trim() ? localized.category.trim() : canonical.category,
		},
		locale: resolved.locale,
		fallback: resolved.fallback,
	};
}
