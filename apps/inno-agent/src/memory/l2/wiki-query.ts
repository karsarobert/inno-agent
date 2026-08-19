import { join } from "node:path";
import { readText, fileExists } from "../../storage/file-store.js";
import { readManifest } from "./manifest-store.js";
import type { ManifestEntry } from "./types.js";
import type { L2Memory } from "./l2-memory.js";

/**
 * Read the wiki index.
 */
export function readIndex(l2DataDir: string): string {
	const indexPath = join(l2DataDir, "wiki", "index.md");
	if (!fileExists(indexPath)) return "Az L2 Wiki még nincs inicializálva; egyelőre nincs index.";
	return readText(indexPath);
}

/**
 * Read a specific wiki page by relative path.
 */
export function readWikiPage(l2DataDir: string, relativePath: string): string | null {
	const absPath = join(l2DataDir, relativePath);
	if (!fileExists(absPath)) return null;
	return readText(absPath);
}

/**
 * Search manifest entries by keyword.
 * Searches title, tags, AND wiki page body content for full recall.
 */
export function searchEntries(l2DataDir: string, query: string): ManifestEntry[] {
	const entries = readManifest(l2DataDir);
	const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
	return entries.filter((entry) => {
		// Search title + tags first (fast path)
		const metaText = [entry.title, ...entry.tags].join(" ").toLowerCase();
		if (keywords.some((kw) => metaText.includes(kw))) return true;
		// Fall back to searching wiki page body content
		for (const wikiPath of entry.wikiPages) {
			const content = readWikiPage(l2DataDir, wikiPath);
			if (content && keywords.some((kw) => content.toLowerCase().includes(kw))) return true;
		}
		return false;
	});
}

/**
 * Query wiki: return index + matched page contents.
 */
export function queryWiki(l2DataDir: string, query: string): string {
	const index = readIndex(l2DataDir);
	const trimmed = (query ?? "").trim();

	// Empty query → just return the index overview.
	if (!trimmed) {
		return `## Wiki-index\n\n${index}\n\n---\n\nTipp: a query paraméter átadásával (pl. „Python async”) megkeresheted és visszakaphatod a kapcsolódó oldalak tartalmát.`;
	}

	const matches = searchEntries(l2DataDir, trimmed);

	if (matches.length === 0) {
		return `## Wiki-index\n\n${index}\n\n---\n\nNem található „${trimmed}” kifejezéshez kapcsolódó tartalom.`;
	}

	const sections: string[] = [
		`## Wiki-index\n\n${index}`,
		"---",
		`## Keresési eredmény: "${trimmed}" (${matches.length} találat)`,
		"",
	];

	for (const entry of matches.slice(0, 5)) {
		for (const wikiPath of entry.wikiPages) {
			const content = readWikiPage(l2DataDir, wikiPath);
			if (content) {
				sections.push(`### [[${entry.title}]]\n`);
				sections.push(content);
				sections.push("---\n");
			}
		}
	}

	return sections.join("\n");
}

/**
 * Query wiki via hybrid retrieval (BM25 + vector + graph), falling back to
 * the substring {@link queryWiki} when the index store is unavailable.
 */
export async function queryWikiHybrid(l2Memory: L2Memory, query: string): Promise<string> {
	const l2DataDir = l2Memory.dataDir;
	const index = readIndex(l2DataDir);
	const trimmed = (query ?? "").trim();

	if (!trimmed) {
		return `## Wiki-index\n\n${index}\n\n---\n\nTipp: a query paraméter átadásával (pl. „Python async”) megkeresheted és visszakaphatod a kapcsolódó oldalak tartalmát.`;
	}

	const results = await l2Memory.search(trimmed, 5);
	if (results === null) return queryWiki(l2DataDir, query);
	if (results.length === 0) {
		return `## Wiki-index\n\n${index}\n\n---\n\nNem található „${trimmed}” kifejezéshez kapcsolódó tartalom.`;
	}

	const sections: string[] = [
		`## Wiki-index\n\n${index}`,
		"---",
		`## Keresési eredmény: "${trimmed}" (${results.length} találat)`,
		"",
	];
	for (const r of results) {
		const content = readWikiPage(l2DataDir, r.path);
		if (content) {
			sections.push(`### [[${r.title}]]  \`${r.path}\`  (${r.via.join("+")})\n`);
			sections.push(content);
			sections.push("---\n");
		}
	}
	return sections.join("\n");
}
