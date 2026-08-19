import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { complete } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

import { ensureDir, readText, writeText } from "../../storage/file-store.js";
import type { ManifestEntry, WikiPageType, WikiPageFrontmatter } from "./types.js";
import { parseFrontmatter, serializeFrontmatter } from "./wiki-maintainer.js";
import { logger } from "../../logger.js";

type LinkablePageType = Extract<WikiPageType, "entity" | "concept">;

interface LinkedItem {
	title: string;
	type: LinkablePageType;
	description: string;
}

export interface WikiLinkMaintenanceResult {
	created: string[];
	updated: string[];
	unchanged: string[];
	/** Pages where a contradiction with the new source was recorded. */
	contested: string[];
	pages: string[];
}

const LINK_MAINTAIN_PROMPT = `Te vagy a tanulási Wiki tudásbázis karbantartó asszisztense.

Az alábbi anyagkivonatból emeld ki a hosszú távon karbantartásra érdemes entitásokat és fogalmakat, és osztályozd őket.

Osztályozási szabályok:
- entity: személyek, szervezetek, cégek, projektek, termékek, tanulmányok, szabványok, keretrendszerek/könyvtárak konkrét nevei.
- concept: technikai fogalmak, elméletek, módszerek, képességek, mechanizmusok, minták, problémattípusok.
- Ne emelj ki túl általános szavakat, pl. "Módszer", "Rendszer", "Tartalom".
- Előnyben részesítsd az anyagban már meglévő [[kétirányú hivatkozás]] bejegyzéseket.
- Legfeljebb 20 bejegyzést adj vissza.

Anyag címe: {title}

Anyagkivonat:
---
{content}
---

Csak JSON-t adj vissza, kódblokk nélkül:
{"items":[{"title":"Szócikk neve","type":"concept","description":"Egymondatos meghatározás vagy leírás"}]}`;

const MAX_LINK_PROMPT_LENGTH = 30000;

function slugifyTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60);
	if (slug) return slug;
	return createHash("sha256").update(title).digest("hex").slice(0, 12);
}

function cleanTitle(title: string): string {
	return title
		.split("|")[0]
		.trim()
		.replace(/^#+\s*/, "")
		.replace(/\s+/g, " ");
}

function extractWikiLinks(content: string): string[] {
	const seen = new Set<string>();
	const titles: string[] = [];
	const linkPattern = /\[\[([^\]]+)\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = linkPattern.exec(content)) !== null) {
		const title = cleanTitle(match[1]);
		if (!isUsefulTitle(title) || seen.has(title)) continue;
		seen.add(title);
		titles.push(title);
	}
	return titles;
}

function isUsefulTitle(title: string): boolean {
	if (title.length < 2 || title.length > 80) return false;
	if (/^https?:\/\//i.test(title)) return false;
	if (/[\\/*?:"<>|]/.test(title)) return false;
	return true;
}

function looksLikeEntity(title: string): boolean {
	if (/\b(et al\.?|Inc\.?|Corp\.?|Ltd\.?|LLC)\b/i.test(title)) return true;
	if (/\b(IEEE|ACM|ISO)\b/.test(title)) return true;
	if (/[A-Za-z]+\s+\d{4}/.test(title)) return true;
	return false;
}

function fallbackItems(content: string): LinkedItem[] {
	return extractWikiLinks(content).slice(0, 20).map((title) => ({
		title,
		type: looksLikeEntity(title) ? "entity" : "concept",
		description: "Az L2 automatikusan azonosítja az anyagkivonat kétirányú hivatkozásaiból; további finomításra vár.",
	}));
}

function parseLinkedItemsJson(text: string): LinkedItem[] {
	const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end < start) return [];
	const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { items?: unknown };
	if (!Array.isArray(parsed.items)) return [];

	const items: LinkedItem[] = [];
	const seen = new Set<string>();
	for (const raw of parsed.items) {
		if (!raw || typeof raw !== "object") continue;
		const record = raw as Record<string, unknown>;
		const title = typeof record.title === "string" ? cleanTitle(record.title) : "";
		const type = record.type === "entity" ? "entity" : record.type === "concept" ? "concept" : null;
		if (!title || !type || !isUsefulTitle(title) || seen.has(title)) continue;
		seen.add(title);
		items.push({
			title,
			type,
			description:
				typeof record.description === "string" && record.description.trim()
					? record.description.trim()
					: "Az L2 automatikusan azonosítja; további finomításra vár.",
		});
	}
	return items;
}

async function extractLinkedItems(
	model: Model<any> | undefined,
	modelRegistry: ModelRegistry | undefined,
	title: string,
	content: string,
): Promise<LinkedItem[]> {
	const fallback = fallbackItems(content);
	if (!model || !modelRegistry) return fallback;

	const truncated =
		content.length > MAX_LINK_PROMPT_LENGTH
			? content.slice(0, MAX_LINK_PROMPT_LENGTH) + "\n\n...(a tartalom csonkolva)"
			: content;
	const prompt = LINK_MAINTAIN_PROMPT.replace("{title}", title).replace("{content}", truncated);

	try {
		const auth = await modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) return fallback;
		const response = await complete(
			model,
			{
				messages: [
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: prompt }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				maxTokens: 4096,
			},
		);
		if (response.stopReason === "error") return fallback;
		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		const extracted = parseLinkedItemsJson(text);
		return extracted.length > 0 ? extracted : fallback;
	} catch (err) {
		logger.warn({ err }, "LLM wiki link extraction failed, using fallback");
		return fallback;
	}
}

function pageDirForType(type: LinkablePageType): string {
	return type === "entity" ? "entities" : "concepts";
}

function relativePagePath(type: LinkablePageType, filename: string): string {
	return join("wiki", pageDirForType(type), filename);
}

function findExistingPage(l2DataDir: string, item: LinkedItem): string {
	const dir = join(l2DataDir, "wiki", pageDirForType(item.type));
	const slugPath = relativePagePath(item.type, `${slugifyTitle(item.title)}.md`);
	const slugAbsPath = join(l2DataDir, slugPath);
	if (existsSync(slugAbsPath)) return slugPath;
	if (!existsSync(dir)) return slugPath;

	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".md")) continue;
		const relativePath = relativePagePath(item.type, file);
		const content = readText(join(l2DataDir, relativePath));
		const { frontmatter } = parseFrontmatter(content);
		const title = frontmatter?.title || basename(file, extname(file));
		if (title === item.title) return relativePath;
	}
	return slugPath;
}

function mergeTags(...tagGroups: string[][]): string[] {
	const seen = new Set<string>();
	const tags: string[] = [];
	for (const group of tagGroups) {
		for (const tag of group) {
			const trimmed = tag.trim();
			if (!trimmed || seen.has(trimmed)) continue;
			seen.add(trimmed);
			tags.push(trimmed);
		}
	}
	return tags.slice(0, 12);
}

function buildNewPage(item: LinkedItem, entry: ManifestEntry, sourcePagePath: string): string {
	const today = new Date().toISOString().slice(0, 10);
	const frontmatter = serializeFrontmatter({
		title: item.title,
		created: today,
		type: item.type,
		tags: mergeTags([item.type], entry.tags),
		sources: [sourcePagePath],
		source_ids: [entry.id],
		updated: today,
		status: "draft",
		confidence: "medium",
	});
	return `${frontmatter}
# ${item.title}

## Meghatározás

${item.description}

## Kapcsolódó anyagok

- [[${entry.title}]] — \`${sourcePagePath}\`
`;
}

function referenceBullet(entry: ManifestEntry, sourcePagePath: string): string {
	return `- [[${entry.title}]] — \`${sourcePagePath}\``;
}

/**
 * Parse a page's frontmatter, let `fn` mutate it, then re-serialize. Returns
 * the original content unchanged (changed=false) when the page has no
 * frontmatter or when the mutation produces no logical difference.
 */
function mutateFrontmatter(
	content: string,
	fn: (fm: WikiPageFrontmatter) => void,
): { content: string; changed: boolean } {
	const { frontmatter, body } = parseFrontmatter(content);
	if (!frontmatter) return { content, changed: false };
	const before = serializeFrontmatter(frontmatter);
	fn(frontmatter);
	const after = serializeFrontmatter(frontmatter);
	if (after === before) return { content, changed: false };
	return { content: `${after}\n${body}`, changed: true };
}

function updateFrontmatterReference(content: string, entry: ManifestEntry, sourcePagePath: string): {
	content: string;
	changed: boolean;
} {
	const today = new Date().toISOString().slice(0, 10);
	return mutateFrontmatter(content, (fm) => {
		if (!fm.sources.includes(sourcePagePath)) fm.sources.push(sourcePagePath);
		if (!fm.source_ids.includes(entry.id)) fm.source_ids.push(entry.id);
		if (!fm.created) fm.created = fm.updated || today;
		fm.updated = today;
	});
}

function addReferenceIfMissing(content: string, entry: ManifestEntry, sourcePagePath: string): string | null {
	const bodyAlreadyReferencesSource = content.includes(sourcePagePath);
	const metadataUpdate = updateFrontmatterReference(content, entry, sourcePagePath);
	content = metadataUpdate.content;
	let changed = metadataUpdate.changed;

	if (bodyAlreadyReferencesSource) return changed ? content : null;

	const bullet = referenceBullet(entry, sourcePagePath);
	const sectionHeader = "\n## Kapcsolódó anyagok";
	const sectionStart = content.indexOf(sectionHeader);
	if (sectionStart >= 0) {
		const bodyStart = sectionStart + sectionHeader.length;
		const nextSection = content.slice(bodyStart).search(/\n## /);
		const insertAt = nextSection >= 0 ? bodyStart + nextSection : content.length;
		const before = content.slice(0, insertAt).trimEnd();
		const after = content.slice(insertAt);
		return `${before}\n${bullet}${after}`;
	}
	return `${content.trimEnd()}\n\n## Kapcsolódó anyagok\n\n${bullet}\n`;
}

function upsertLinkedPage(
	l2DataDir: string,
	item: LinkedItem,
	entry: ManifestEntry,
	sourcePagePath: string,
): { path: string; status: "created" | "updated" | "unchanged" } {
	const relativePath = findExistingPage(l2DataDir, item);
	const absPath = join(l2DataDir, relativePath);
	ensureDir(join(l2DataDir, "wiki", pageDirForType(item.type)));

	if (!existsSync(absPath)) {
		writeText(absPath, buildNewPage(item, entry, sourcePagePath));
		return { path: relativePath, status: "created" };
	}

	const existing = readText(absPath);
	const updated = addReferenceIfMissing(existing, entry, sourcePagePath);
	if (!updated) return { path: relativePath, status: "unchanged" };
	writeText(absPath, updated);
	return { path: relativePath, status: "updated" };
}

/**
 * Maintain entity/concept pages after a source page is created.
 *
 * The source page keeps the original summary. This function creates or updates
 * linked entity/concept pages, then returns their paths so the manifest and
 * index can include them in the same archive transaction.
 *
 * With a model available this runs two-stage CoT: (1) extract candidates and
 * read their existing page definitions, (2) plan create/update with merged
 * definitions and contradiction detection, then write/merge. Without a model
 * the original non-destructive behavior (create-or-append-reference) applies.
 */
export async function maintainLinkedWikiPages(
	l2DataDir: string,
	entry: ManifestEntry,
	sourcePagePath: string,
	sourcePageBody: string,
	model?: Model<any>,
	modelRegistry?: ModelRegistry,
): Promise<WikiLinkMaintenanceResult> {
	const result: WikiLinkMaintenanceResult = { created: [], updated: [], unchanged: [], contested: [], pages: [] };
	const items = await extractLinkedItems(model, modelRegistry, entry.title, sourcePageBody);

	// Stage 1: read existing definitions for all candidates, build plan.
	const candidates = items.map((it) => ({
		title: it.title,
		type: it.type,
		existingDefinition: readExistingDefinition(l2DataDir, it),
	}));
	const plan = await planLinkedItems(model, modelRegistry, entry.title, sourcePageBody, candidates);

	if (plan) {
		// Stage 2: write/merge according to plan.
		for (const p of plan) {
			const page = upsertPlannedPage(l2DataDir, p, entry, sourcePagePath);
			result.pages.push(page.path);
			result[page.status].push(page.path);
			if (page.contested) result.contested.push(page.path);
		}
	} else {
		// Fallback: original non-destructive create-or-append-reference.
		for (const item of items) {
			const page = upsertLinkedPage(l2DataDir, item, entry, sourcePagePath);
			result.pages.push(page.path);
			result[page.status].push(page.path);
		}
	}
	result.pages = [...new Set(result.pages)];
	return result;
}

// ============================================================================
// Two-stage CoT helpers
// ============================================================================

interface PlanItem {
	title: string;
	type: LinkablePageType;
	action: "create" | "update";
	definition: string;
	contradiction?: string;
}

const STAGE1_PLAN_PROMPT = `Te vagy a tanulási Wiki tudásbázis karbantartás-tervező asszisztense. Ismert egy új anyag kivonata, valamint a tudásbázis egyes entitás-/fogalomoldalainak meglévő definíciói. Tervezd meg, hogyan kell karbantartani az egyes bejegyzéseket.

Szabályok:
- action=create: a tudásbázisban még nincs ilyen bejegyzés (a meglévő definíció üres). A definition-be írj egy-három mondatos magyar definíciót.
- action=update: már létezik ilyen bejegyzés. **Ötvözd** az új anyag információit a meglévő definícióval, és írj teljesebb, pontosabb, ismétlésmentes definition-t (az egyesített teljes meghatározást, ne csupán hozzáfűzést).
- Ha az új anyag és a meglévő definíció között **ténybeli ellentmondás/konfliktus** van, a contradiction mezőbe írj egy mondatos ellentmondás-magyarázatot; egyébként null legyen.
- A definition a „Mi ez” kérdésre fókuszáljon; ne írj bele a tanuló személyes állapotát, céljait vagy preferenciáit.
- Legfeljebb 20 bejegyzést dolgozz fel.

Anyag címe: {title}

Anyagkivonat:
---
{summary}
---

Jelölt bejegyzések (üres existingDefinition = a tudásbázisban még nincs ilyen bejegyzés):
{candidates}

Csak JSON-t adj vissza, kódblokk nélkül:
{"items":[{"title":"Szócikk neve","type":"concept","action":"update","definition":"Az egyesített teljes meghatározás","contradiction":null}]}`;

function parsePlanItems(text: string): PlanItem[] {
	const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end < start) return [];
	let parsed: { items?: unknown };
	try {
		parsed = JSON.parse(trimmed.slice(start, end + 1)) as { items?: unknown };
	} catch {
		return [];
	}
	if (!Array.isArray(parsed.items)) return [];
	const planItems: PlanItem[] = [];
	const seen = new Set<string>();
	for (const raw of parsed.items) {
		if (!raw || typeof raw !== "object") continue;
		const rec = raw as Record<string, unknown>;
		const title = typeof rec.title === "string" ? cleanTitle(rec.title) : "";
		const type = rec.type === "entity" ? "entity" : rec.type === "concept" ? "concept" : null;
		if (!title || !type || !isUsefulTitle(title) || seen.has(title)) continue;
		const definition = typeof rec.definition === "string" ? rec.definition.trim() : "";
		if (!definition) continue;
		seen.add(title);
		planItems.push({
			title,
			type,
			action: rec.action === "update" ? "update" : "create",
			definition,
			contradiction:
				typeof rec.contradiction === "string" && rec.contradiction.trim() ? rec.contradiction.trim() : undefined,
		});
	}
	return planItems;
}

function readExistingDefinition(l2DataDir: string, item: LinkedItem): string | undefined {
	const rel = findExistingPage(l2DataDir, item);
	const abs = join(l2DataDir, rel);
	if (!existsSync(abs)) return undefined;
	const { body } = parseFrontmatter(readText(abs));
	const idx = body.indexOf("## Meghatározás");
	if (idx < 0) return undefined;
	const rest = body.slice(idx + "## Meghatározás".length);
	const nextSec = rest.search(/\n## /);
	const def = (nextSec >= 0 ? rest.slice(0, nextSec) : rest).trim();
	return def || undefined;
}

async function planLinkedItems(
	model: Model<any> | undefined,
	modelRegistry: ModelRegistry | undefined,
	title: string,
	summary: string,
	candidates: { title: string; type: LinkablePageType; existingDefinition?: string }[],
): Promise<PlanItem[] | null> {
	if (!model || !modelRegistry || candidates.length === 0) return null;
	const candidateJson = JSON.stringify(
		candidates.map((c) => ({
			title: c.title,
			type: c.type,
			existingDefinition: c.existingDefinition ? c.existingDefinition.slice(0, 600) : "",
		})),
	);
	const truncatedSummary =
		summary.length > MAX_LINK_PROMPT_LENGTH ? summary.slice(0, MAX_LINK_PROMPT_LENGTH) + "\n\n...(a tartalom csonkolva)" : summary;
	const prompt = STAGE1_PLAN_PROMPT
		.replace("{title}", title)
		.replace("{summary}", truncatedSummary)
		.replace("{candidates}", candidateJson);
	try {
		const auth = await modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) return null;
		const response = await complete(
			model,
			{ messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }], timestamp: Date.now() }] },
			{ apiKey: auth.apiKey, headers: auth.headers, maxTokens: 4096 },
		);
		if (response.stopReason === "error") return null;
		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		const plan = parsePlanItems(text);
		return plan.length > 0 ? plan : null;
	} catch (err) {
		logger.warn({ err }, "LLM ingest planning failed, using fallback");
		return null;
	}
}

function replaceDefinitionSection(content: string, newDef: string): string {
	const header = "## Meghatározás";
	const idx = content.indexOf(header);
	if (idx < 0) {
		const relIdx = content.indexOf("\n## Kapcsolódó anyagok");
		const section = `## Meghatározás\n\n${newDef}\n\n`;
		if (relIdx >= 0) return `${content.slice(0, relIdx + 1)}${section}${content.slice(relIdx + 1)}`;
		return `${content.trimEnd()}\n\n${section}`;
	}
	const bodyStart = idx + header.length;
	const rest = content.slice(bodyStart);
	const nextSec = rest.search(/\n## /);
	const insertEnd = nextSec >= 0 ? bodyStart + nextSec : content.length;
	return `${content.slice(0, bodyStart)}\n\n${newDef}\n${content.slice(insertEnd)}`;
}

function applyContradiction(content: string, entry: ManifestEntry, note: string): string | null {
	const fmResult = mutateFrontmatter(content, (fm) => {
		fm.contested = true;
		if (!fm.contradictions) fm.contradictions = [];
		if (!fm.contradictions.includes(entry.id)) fm.contradictions.push(entry.id);
	});
	let next = fmResult.content;
	let changed = fmResult.changed;
	if (!next.includes(note)) {
		const bullet = `- ${note} (forrás [[${entry.title}]] \`${entry.id}\`)`;
		const header = "\n## Vita";
		const idx = next.indexOf(header);
		if (idx >= 0) {
			const bodyStart = idx + header.length;
			const rest = next.slice(bodyStart);
			const nextSec = rest.search(/\n## /);
			const insertAt = nextSec >= 0 ? bodyStart + nextSec : next.length;
			next = `${next.slice(0, insertAt).trimEnd()}\n${bullet}${next.slice(insertAt)}`;
		} else {
			next = `${next.trimEnd()}\n\n## Vita\n\n${bullet}\n`;
		}
		changed = true;
	}
	return changed ? next : null;
}

function mergeIntoExistingPage(
	content: string,
	item: PlanItem,
	entry: ManifestEntry,
	sourcePagePath: string,
): { content: string; contested: boolean } | null {
	let next = content;
	let changed = false;
	let contested = false;
	if (item.definition) {
		const replaced = replaceDefinitionSection(next, item.definition);
		if (replaced !== next) { next = replaced; changed = true; }
	}
	const withRef = addReferenceIfMissing(next, entry, sourcePagePath);
	if (withRef) { next = withRef; changed = true; }
	if (item.contradiction) {
		const withContra = applyContradiction(next, entry, item.contradiction);
		if (withContra) { next = withContra; changed = true; contested = true; }
	}
	return changed ? { content: next, contested } : null;
}

function upsertPlannedPage(
	l2DataDir: string,
	item: PlanItem,
	entry: ManifestEntry,
	sourcePagePath: string,
): { path: string; status: "created" | "updated" | "unchanged"; contested: boolean } {
	const linked: LinkedItem = { title: item.title, type: item.type, description: item.definition };
	const relativePath = findExistingPage(l2DataDir, linked);
	const absPath = join(l2DataDir, relativePath);
	ensureDir(join(l2DataDir, "wiki", pageDirForType(item.type)));
	if (!existsSync(absPath)) {
		writeText(absPath, buildNewPage(linked, entry, sourcePagePath));
		return { path: relativePath, status: "created", contested: false };
	}
	const merged = mergeIntoExistingPage(readText(absPath), item, entry, sourcePagePath);
	if (!merged) return { path: relativePath, status: "unchanged", contested: false };
	writeText(absPath, merged.content);
	return { path: relativePath, status: "updated", contested: merged.contested };
}
