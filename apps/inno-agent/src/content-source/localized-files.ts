import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeContentLocale, resolveContentLocale, type ContentLocale } from "./content-locale.js";

export interface MaterializedContentLocale {
	locale: ContentLocale | null;
	fallback: boolean;
}

export interface MaterializeLocalizedContentOptions {
	excludeBaseEntries?: readonly string[];
}

function copyDirectoryContents(sourceDir: string, targetDir: string, excluded: ReadonlySet<string> = new Set()): void {
	mkdirSync(targetDir, { recursive: true });
	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		if (excluded.has(entry.name)) continue;
		cpSync(join(sourceDir, entry.name), join(targetDir, entry.name), { recursive: true });
	}
}

function availableLocalizedDirectories(sourceDir: string, markerFile: string): ContentLocale[] {
	const localesDir = join(sourceDir, "locales");
	if (!existsSync(localesDir)) return [];
	return readdirSync(localesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(localesDir, entry.name, markerFile)))
		.map((entry) => normalizeContentLocale(entry.name))
		.filter((locale): locale is ContentLocale => locale !== null);
}

/**
 * Materialize a Hub item into an active workspace/skill directory. Shared files
 * stay in place while a selected locale tree overlays language-specific files.
 */
export function materializeLocalizedContent(
	sourceDir: string,
	targetDir: string,
	markerFile: string,
	requestedLocale: unknown,
	options: MaterializeLocalizedContentOptions = {},
): MaterializedContentLocale {
	copyDirectoryContents(sourceDir, targetDir, new Set(["locales", ...(options.excludeBaseEntries ?? [])]));
	const selected = resolveContentLocale(requestedLocale, availableLocalizedDirectories(sourceDir, markerFile));
	if (!selected) return { locale: null, fallback: true };
	copyDirectoryContents(join(sourceDir, "locales", selected.locale), targetDir);
	return selected;
}
