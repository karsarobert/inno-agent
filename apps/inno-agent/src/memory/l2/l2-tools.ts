import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomUUID, createHash } from "node:crypto";
import { join, isAbsolute, resolve } from "node:path";

import type { ManifestEntry, RawSourceType } from "./types.js";
import { saveRaw, saveRawFile } from "./raw-store.js";
import { convertToExtracted } from "./source-converter.js";
import { appendManifest, readManifest, findManifestByHash } from "./manifest-store.js";
import {
	createSourcePage,
	rebuildIndex,
	appendLog,
	ensureL2Directories,
	readMaintenanceContext,
} from "./wiki-maintainer.js";
import { queryWikiHybrid } from "./wiki-query.js";
import { summarizeContent } from "./summarizer.js";
import { maintainLinkedWikiPages } from "./wiki-linker.js";
import { readText } from "../../storage/file-store.js";
import { parseDocument, DocumentParseError } from "./document-parser.js";
import { getL2Memory, type L2Memory } from "./l2-memory.js";
import { regenerateOverview } from "./overview.js";
import { logger } from "../../logger.js";

/**
 * Create L2 Wiki memory tools for the Inno Agent.
 * When `isEnabled` is provided and returns false, the archive/query tools
 * short-circuit to a disabled notice without touching the knowledge base.
 * `l2Memory` keeps the retrieval index in sync; defaults to the per-dir
 * singleton so callers that don't pass one still get index maintenance.
 */
export function createL2Tools(
	l2DataDir: string,
	isEnabled?: () => boolean,
	l2Memory: L2Memory = getL2Memory(l2DataDir),
): ToolDefinition[] {
	const l2DisabledResult = () => ({
		content: [{ type: "text" as const, text: "Az L2 Wiki tudásbázis ki van kapcsolva a beállításokban; jelenleg sem archiválás, sem keresés nem történik benne." }],
		details: { disabled: true },
	});

	// ---- Tool 1: l2_archive ----
	const archiveTool = defineTool({
		name: "l2_archive",
		label: "Archiválás az L2 Wiki-be",
		description:
			"Tananyag archiválása az L2 Wiki tudásbázisba. Akkor hívd, ha a felhasználó azt mondja: „archiválás”, „mentés a tudásbázisba”, „jegyezd meg nekem”, vagy tananyagot tölt fel tanulás/összefoglalás céljából." +
			"Támogatott: szöveg (text), Markdown (markdown), beszélgetésrészlet (conversation), PDF (pdf), Word-dokumentum (word), kép (image)." +
			"Szöveges tartalom esetén a content paramétert add meg; fájl esetén a filePath paramétert.",
		parameters: Type.Object({
			title: Type.String({ description: "Anyag címe" }),
			content: Type.Optional(Type.String({ description: "Az archiválandó szöveges tartalom (a filePath helyett)" })),
			filePath: Type.Optional(Type.String({ description: "Az archiválandó fájl elérési útja (PDF/Word/kép); a content helyett" })),
			sourceType: StringEnum(["text", "markdown", "conversation", "pdf", "word", "image"] as const, {
				description: "Anyagtípus: text (sima szöveg), markdown, conversation (beszélgetésrészlet), pdf, word, image",
			}),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Címkelista, pl. ['python', 'async']" })),
			origin: Type.Optional(
				StringEnum(["user_upload", "conversation", "web", "research", "agent_inferred"] as const, {
					description: "Forrástípus; alapértelmezésben a sourceType alapján automatikusan következtet",
				}),
			),
			url: Type.Optional(Type.String({ description: "Forrás URL (weboldal, tanulmányhivatkozás stb.)" })),
			sessionId: Type.Optional(Type.String({ description: "Kapcsolódó munkamenet-azonosító" })),
			force: Type.Optional(Type.Boolean({ description: "true esetén kihagyja az ismétlődés-ellenőrzést, és kényszerített archiválást végez" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (isEnabled && !isEnabled()) return l2DisabledResult();
			ensureL2Directories(l2DataDir);
			const maintenanceContext = readMaintenanceContext(l2DataDir);

			const sourceType = params.sourceType as RawSourceType;
			const isFileType = sourceType === "pdf" || sourceType === "word" || sourceType === "image";

			// Resolve content: either from params.content or by parsing a file
			let content: string;
			let resolvedFilePath: string | undefined;

			if (isFileType && params.filePath) {
				// File-based: parse with LiteParse
				const workspaceDir = process.env.INNO_WORKSPACE_DIR || process.cwd();
				resolvedFilePath = isAbsolute(params.filePath)
					? params.filePath
					: resolve(workspaceDir, params.filePath);

				let parsed;
				try {
					parsed = await parseDocument(resolvedFilePath);
				} catch (err) {
					logger.warn({ err, filePath: resolvedFilePath }, "l2_archive: failed to parse document");
					const msg = err instanceof DocumentParseError ? err.message : String(err);
					return {
						content: [{ type: "text" as const, text: `A fájl feldolgozása sikertelen: ${msg}` }],
						details: { error: err instanceof DocumentParseError ? err.code : "parse_error" },
					};
				}

				content = parsed.text;
			} else if (params.content) {
				// Text-based: use content directly
				content = params.content;
			} else {
				return {
					content: [{ type: "text" as const, text: "Paraméterhiba: meg kell adni content (szöveges tartalom) vagy filePath (fájl elérési út) értéket." }],
					details: { error: "missing_content" },
				};
			}

			const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);

			// Dedup: check if same content already archived
			if (!params.force) {
				const existing = findManifestByHash(l2DataDir, contentHash);
				if (existing) {
					return {
						content: [
							{
								type: "text" as const,
								text:
									`Ez a tartalom már archiválva van, nem kell újra menteni.\n\n` +
									`- ID: ${existing.id}\n` +
									`- Cím: ${existing.title}\n` +
									`- Wiki-oldal: ${existing.wikiPages.join(", ") || "Nincs"}\n\n` +
									`Kényszerített archiváláshoz állítsd a force értékét true-ra.`,
							},
						],
						details: { id: existing.id, duplicate: true },
					};
				}
			}

			const rawPath = resolvedFilePath
				? saveRawFile(l2DataDir, params.title, resolvedFilePath, sourceType)
				: saveRaw(l2DataDir, params.title, content, sourceType, params.url);

			const id = `l2src_${randomUUID().slice(0, 8)}`;
			const tags = params.tags ?? [];

			// Convert to extracted markdown
			const extractedPath = convertToExtracted(l2DataDir, params.title, content, sourceType);

			// Build manifest entry
			const inferredOrigin = sourceType === "conversation" ? "conversation" : "user_upload";
			const entry: ManifestEntry = {
				id,
				title: params.title,
				sourceType,
				rawPath,
				extractedPath,
				wikiPages: [],
				tags,
				contentHash,
				status: "extracted",
				source: {
					origin: (params.origin ?? inferredOrigin) as ManifestEntry["source"]["origin"],
					...(params.url && { url: params.url }),
					...(params.sessionId && { sessionId: params.sessionId }),
				},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			// Create wiki source page (with LLM summary)
			const extractedContent = readText(join(l2DataDir, extractedPath));
			let summaryBody = `## Összegzés\n\n${extractedContent}`;
			if (ctx.model) {
				const summary = await summarizeContent(ctx.model, ctx.modelRegistry, params.title, extractedContent);
				if (summary) summaryBody = summary;
			}
			const wikiPagePath = createSourcePage(l2DataDir, entry, summaryBody, extractedPath);
			const linkMaintenance = await maintainLinkedWikiPages(
				l2DataDir,
				entry,
				wikiPagePath,
				summaryBody,
				ctx.model,
				ctx.modelRegistry,
			);
			entry.wikiPages = [wikiPagePath, ...linkMaintenance.pages];
			entry.status = "indexed";

			// Write manifest
			appendManifest(l2DataDir, entry);

			// Rebuild index
			const allEntries = readManifest(l2DataDir);
			rebuildIndex(l2DataDir, allEntries);

			// Keep the retrieval index in sync with the touched pages.
			for (const wikiPath of entry.wikiPages) {
				await l2Memory.indexPageByPath(wikiPath);
			}

			// Regenerate the knowledge-base overview (best-effort; never fails archive).
			try {
				const overviewPath = await regenerateOverview(l2DataDir, ctx.model, ctx.modelRegistry);
				if (overviewPath) await l2Memory.indexPageByPath(overviewPath);
			} catch (err) {
				logger.warn({ err }, "l2_archive: overview regeneration failed");
			}

			// Append log
			appendLog(
				l2DataDir,
				"ingest",
				params.title,
				[
					`- ID: ${id}`,
					`- Típus: ${sourceType}`,
					`- Eredeti fájl: ${rawPath}`,
					`- Kinyert szöveg: ${extractedPath}`,
					`- Forrásoldal: ${wikiPagePath}`,
					`- fogalmak/entitások: új ${linkMaintenance.created.length}, frissített ${linkMaintenance.updated.length}, változatlan ${linkMaintenance.unchanged.length}, vitatott ${linkMaintenance.contested.length}`,
					`- Karbantartás előtti kontextus: séma ${maintenanceContext.schema.length} karakter, index ${maintenanceContext.index.length} karakter, legutóbbi napló ${maintenanceContext.recentLog.length} karakter`,
				].join("\n"),
			);

			return {
				content: [
					{
						type: "text" as const,
						text:
							`Az anyag archiválva az L2 Wiki-be.\n\n` +
							`- ID: ${id}\n` +
							`- Cím: ${params.title}\n` +
							`- Eredeti fájl: ${rawPath}\n` +
							`- Wiki-oldal: ${wikiPagePath}\n` +
							`- Automatikus karbantartás: ${linkMaintenance.created.length} új fogalom/entitásoldal, ${linkMaintenance.updated.length} frissített\n` +
							`- Címkék: ${tags.join(", ") || "Nincs"}\n\n` +
							`A Wiki-index frissítve.`,
					},
				],
				details: { id, rawPath, wikiPagePath, linkedPages: linkMaintenance.pages },
			};
		},
	});

	// ---- Tool 2: l2_query ----
	const queryTool = defineTool({
		name: "l2_query",
		label: "L2 Wiki lekérdezése",
		description:
			"Az L2 Wiki tudásbázis lekérdezése. Akkor hívd, ha az archivált tananyaggal kapcsolatos kérdésre kell válaszolni." +
			"Először olvasd be az indexet, majd keresd meg és olvasd be a releváns oldalakat, és összesítve válaszolj." +
			"A query paraméter elhagyható vagy üres lehet; ekkor a Wiki-index áttekintése tér vissza (a tartalom megtekintéséhez).",
		parameters: Type.Object({
			query: Type.Optional(
				Type.String({
					default: "",
					description:
						"Keresés kulcsszó vagy kérdés alapján, pl. „Python async”, „a legutóbb olvasott tanulmány”. Ha üres vagy elmarad, a Wiki-index áttekintése tér vissza.",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			if (isEnabled && !isEnabled()) return l2DisabledResult();
			ensureL2Directories(l2DataDir);
			const query = params.query ?? "";
			const result = await queryWikiHybrid(l2Memory, query);
			appendLog(l2DataDir, "query", query, "- L2 query executed through l2_query.");
			return {
				content: [{ type: "text" as const, text: result }],
				details: {},
			};
		},
	});

	return [archiveTool, queryTool];
}
