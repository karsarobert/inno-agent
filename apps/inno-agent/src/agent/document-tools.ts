import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { parseDocument, screenshotDocument, DocumentParseError } from "../memory/l2/document-parser.js";
import { logger } from "../logger.js";

/**
 * Create document parsing tools for the Inno Agent.
 */
export function createDocumentTools(): ToolDefinition[] {
	const parseDocumentTool = defineTool({
		name: "parse_document",
		label: "Dokumentum feldolgozása",
		description:
			"PDF, Word, Excel, PPT vagy képfájlok feldolgozása szöveg kinyeréséhez." +
			"Akkor hívd, ha a felhasználó meg szeretné nézni egy fájl tartalmát, szöveget szeretne kinyerni, vagy előbb előnézetet szeretne, mielőtt eldönti, archiválja-e." +
			"Támogatott formátumok: .pdf, .docx, .xlsx, .pptx, .png, .jpg, .jpeg, .gif, .webp, .tiff",
		parameters: Type.Object({
			filePath: Type.String({ description: "Fájl elérési út (abszolút vagy a munkakönyvtárhoz viszonyított)" }),
			includePageDetails: Type.Optional(
				Type.Boolean({
					description: "true esetén oldalanként adja vissza a szöveget; alapértelmezés szerint csak az összefűzött teljes szöveget",
				}),
			),
			includeScreenshots: Type.Optional(
				Type.Boolean({
					description: "true esetén oldalanként PNG-képernyőképet ad vissza (csak PDF-nél); alapértelmezés szerint false",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const typed = params as {
				filePath: string;
				includePageDetails?: boolean;
				includeScreenshots?: boolean;
			};

			// Resolve path relative to workspace
			const workspaceDir = process.env.INNO_WORKSPACE_DIR || process.cwd();
			const resolvedPath = isAbsolute(typed.filePath)
				? typed.filePath
				: resolve(workspaceDir, typed.filePath);

			// Check file existence before attempting parse
			if (!existsSync(resolvedPath)) {
				return {
					content: [{ type: "text" as const, text: `A fájl nem létezik: ${typed.filePath}` }],
					details: { error: "file_not_found", filePath: resolvedPath, pageCount: 0, textLength: 0 },
				};
			}

			// Parse document
			let parsed;
			try {
				parsed = await parseDocument(resolvedPath);
			} catch (err) {
				logger.warn({ err, filePath: resolvedPath }, "parse_document tool: document parsing failed");
				const msg = err instanceof DocumentParseError
					? err.message
					: (err instanceof Error ? err.message : String(err));
				const code = err instanceof DocumentParseError ? err.code : "unknown";
				return {
					content: [{ type: "text" as const, text: `A dokumentum feldolgozása sikertelen: ${msg}` }],
					details: { error: code, filePath: resolvedPath, pageCount: 0, textLength: 0 },
				};
			}

			// Build response
			const lines: string[] = [
				`Fájl: ${typed.filePath}`,
				`Oldalszám: ${parsed.pageCount}`,
				`Szöveghossz: ${parsed.text.length} karakter`,
				"",
				"--- Kinyert szöveg ---",
				parsed.text,
			];

			if (typed.includePageDetails && parsed.pages.length > 1) {
				lines.push("", "--- Oldalankénti szöveg ---");
				for (const page of parsed.pages) {
					lines.push(``, `[${page.pageNumber}. oldal]`, page.text);
				}
			}

			const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
				{ type: "text", text: lines.join("\n") },
			];

			// Screenshots
			if (typed.includeScreenshots) {
				try {
					const screenshots = await screenshotDocument(resolvedPath);
					for (const shot of screenshots) {
						content.push({
							type: "image",
							data: shot.imageBuffer.toString("base64"),
							mimeType: "image/png",
						});
					}
				} catch (err) {
					logger.warn({ err }, "document screenshot generation failed");
					content.push({
						type: "text",
						text: "\n[A képernyőkép generálása sikertelen; a fájlformátum valószínűleg nem támogatja]",
					});
				}
			}

			return {
				content,
				details: {
					error: undefined as string | undefined,
					filePath: resolvedPath,
					pageCount: parsed.pageCount,
					textLength: parsed.text.length,
				},
			};
		},
	});

	return [parseDocumentTool];
}
