/**
 * OCR tool — calls the Baidu PaddleOCR-VL API (async job: submit → poll → fetch
 * result). Used when the configured chat model cannot natively recognize
 * images. The agent is steered to this tool via the system prompt.
 *
 * API shape (reference: apps/inno-agent/temp-call-ocr-api.txt):
 *   POST {baseUrl}                  // submit job
 *     - URL mode:    JSON body { fileUrl, model, optionalPayload }
 *     - File mode:   multipart/form-data with `file`, `model`, `optionalPayload`
 *   GET  {baseUrl}/{jobId}          // poll status (pending/running/done/failed)
 *   GET  {data.resultUrl.jsonUrl}  // fetch newline-delimited JSON results
 *
 * The auth header is `Authorization: bearer {token}`.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ConfigHolder } from "./inno-extension.js";
import { logger } from "../logger.js";

/** Default endpoint for the public PaddleOCR-VL service. */
const DEFAULT_OCR_BASE_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
/** Default model identifier. */
const DEFAULT_OCR_MODEL = "PaddleOCR-VL-1.6";

/** Optional parsing flags passed through to the OCR backend. */
const OPTIONAL_PAYLOAD = {
	useDocOrientationClassify: false,
	useDocUnwarping: false,
	useChartRecognition: false,
};

/** Poll interval for job status. */
const POLL_INTERVAL_MS = 3_000;
/** Upper bound for the whole submit+poll cycle. */
const MAX_TOTAL_TIMEOUT_MS = 5 * 60_000;
/** Per-request network timeout. */
const REQUEST_TIMEOUT_MS = 60_000;

interface OcrApiConfig {
	token: string;
	model: string;
	baseUrl: string;
}

function resolveOcrConfig(holder: ConfigHolder): OcrApiConfig | undefined {
	const cfg = holder.current.ocrApi;
	if (!cfg || !cfg.token.trim()) return undefined;
	return {
		token: cfg.token.trim(),
		model: cfg.model?.trim() || DEFAULT_OCR_MODEL,
		baseUrl: cfg.baseUrl?.trim() || DEFAULT_OCR_BASE_URL,
	};
}

function authHeaders(token: string): Record<string, string> {
	return { Authorization: `bearer ${token}` };
}

function isHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

/**
 * Resolve a workspace-relative or absolute local path. Returns null for paths
 * that escape the workspace root via `..`.
 */
function resolveLocalPath(filePath: string): string | null {
	const workspaceDir = process.env.INNO_WORKSPACE_DIR || process.cwd();
	const root = resolve(workspaceDir);
	const cleaned = isAbsolute(filePath) ? filePath : filePath.replace(/^\/+/, "");
	const resolved = resolve(root, cleaned);
	const rel = relative(root, resolved);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
	return resolved;
}

/** Submit an OCR job. Returns the jobId. */
async function submitJob(cfg: OcrApiConfig, filePath: string, signal: AbortSignal): Promise<string> {
	const headers = authHeaders(cfg.token);
	const endpoint = cfg.baseUrl;

	if (isHttpUrl(filePath)) {
		const body = {
			fileUrl: filePath,
			model: cfg.model,
			optionalPayload: OPTIONAL_PAYLOAD,
		};
		const resp = await fetch(endpoint, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal,
		});
		const text = await resp.text();
		if (!resp.ok) throw new Error(`OCR submit failed: ${resp.status} ${text.slice(0, 500)}`);
		const data = JSON.parse(text) as { data?: { jobId?: string } };
		const jobId = data.data?.jobId;
		if (!jobId) throw new Error(`OCR submit: missing jobId in response: ${text.slice(0, 300)}`);
		return jobId;
	}

	// Local file mode — multipart/form-data with file, model, optionalPayload.
	const localPath = resolveLocalPath(filePath);
	if (!localPath || !existsSync(localPath) || !statSync(localPath).isFile()) {
		throw new Error(`A képfájl nem található: ${filePath}`);
	}
	const buffer = readFileSync(localPath);
	const form = new FormData();
	form.set("model", cfg.model);
	form.set("optionalPayload", JSON.stringify(OPTIONAL_PAYLOAD));
	// Uint8Array copy so the Blob owns a plain ArrayBuffer (not Node's pooled one).
	form.set("file", new Blob([new Uint8Array(buffer)]), basename(localPath));

	const resp = await fetch(endpoint, {
		method: "POST",
		headers, // fetch sets the multipart boundary automatically
		body: form,
		signal,
	});
	const text = await resp.text();
	if (!resp.ok) throw new Error(`OCR submit failed: ${resp.status} ${text.slice(0, 500)}`);
	const data = JSON.parse(text) as { data?: { jobId?: string } };
	const jobId = data.data?.jobId;
	if (!jobId) throw new Error(`OCR submit: missing jobId in response: ${text.slice(0, 300)}`);
	return jobId;
}

interface JobStatus {
	state: "pending" | "running" | "done" | "failed" | string;
	errorMsg?: string;
	resultUrl?: { jsonUrl?: string };
}

async function pollJob(cfg: OcrApiConfig, jobId: string, signal: AbortSignal): Promise<JobStatus> {
	const resp = await fetch(`${cfg.baseUrl}/${jobId}`, {
		method: "GET",
		headers: authHeaders(cfg.token),
		signal,
	});
	const text = await resp.text();
	if (!resp.ok) throw new Error(`OCR poll failed: ${resp.status} ${text.slice(0, 500)}`);
	const data = JSON.parse(text) as { data?: JobStatus };
	if (!data.data) throw new Error(`OCR poll: missing data in response: ${text.slice(0, 300)}`);
	return data.data;
}

/** Fetch the newline-delimited JSON result and assemble markdown per page. */
async function fetchResult(jsonUrl: string, signal: AbortSignal): Promise<string> {
	const resp = await fetch(jsonUrl, { signal });
	if (!resp.ok) throw new Error(`OCR result fetch failed: ${resp.status}`);
	const text = await resp.text();
	const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
	const pages: string[] = [];
	for (const line of lines) {
		let parsed: { result?: { layoutParsingResults?: Array<{ markdown?: { text?: string } }> } };
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		const results = parsed.result?.layoutParsingResults ?? [];
		for (const res of results) {
			const md = res.markdown?.text;
			if (md && md.trim()) pages.push(md);
		}
	}
	return pages.join("\n\n---\n\n");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolveSleep, reject) => {
		const t = setTimeout(resolveSleep, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(t);
				reject(new Error("aborted"));
			},
			{ once: true },
		);
	});
}

/**
 * Create the OCR tool. Reads the API credentials live from configHolder so
 * settings changes take effect without a restart.
 */
export function createOcrTools(configHolder: ConfigHolder): ToolDefinition[] {
	const tool = defineTool({
		name: "ocr_image",
		label: "Képszöveg-felismerés (OCR)",
		description:
			"A Baidu vl-ocr (PaddleOCR-VL) API meghívása a képek szövegének kinyeréséhez; markdown szöveget ad vissza." +
			"Akkor hívd, ha a jelenlegi modell nem támogatja a képfelismerést, vagy a képfelismerés sikertelen." +
			"A filePath lehet munkaterület-relative elérési út vagy http(s) URL is." +
			"Gyakori formátumok támogatottak: PNG / JPG / JPEG / GIF / WEBP / TIFF / PDF.",
		parameters: Type.Object({
			filePath: Type.String({
				description: "A felismerendő kép elérési útja (munkaterület-relative, abszolút vagy http(s) URL)",
			}),
		}),
		async execute(_toolCallId, params) {
			const typed = params as { filePath: string };
			const filePath = String(typed.filePath ?? "").trim();
			if (!filePath) {
				return {
					content: [{ type: "text" as const, text: "Adj meg filePath értéket (kép elérési út vagy URL)." }],
					details: { error: "missing_file_path" } as Record<string, unknown>,
				};
			}

			const cfg = resolveOcrConfig(configHolder);
			if (!cfg) {
				return {
					content: [{
						type: "text" as const,
						text: "Az OCR API token nincs beállítva. Töltsd ki a tokent a Beállítások „OCR API” kártyáján, majd próbáld újra.",
					}],
					details: { error: "ocr_not_configured" } as Record<string, unknown>,
				};
			}

			const controller = new AbortController();
			const totalTimer = setTimeout(() => controller.abort(), MAX_TOTAL_TIMEOUT_MS);
			const signal = controller.signal;

			try {
				let jobId: string;
				try {
					jobId = await submitJob(cfg, filePath, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
				} catch (err) {
					logger.warn({ err, filePath }, "ocr_image: submit failed");
					const msg = err instanceof Error ? err.message : String(err);
					return {
						content: [{ type: "text" as const, text: `Az OCR feladat elküldése sikertelen: ${msg}` }],
						details: { error: "submit_failed", filePath, message: msg } as Record<string, unknown>,
					};
				}
				logger.info({ jobId, filePath }, "ocr_image: job submitted");

				// Poll until terminal state.
				let status: JobStatus;
				while (true) {
					await sleep(POLL_INTERVAL_MS, signal).catch(() => {
						throw new Error("Az OCR lekérdezés megszakadt (időtúllépés vagy törlés)");
					});
					status = await pollJob(cfg, jobId, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
					if (status.state === "done") break;
					if (status.state === "failed") {
						const msg = status.errorMsg || "Az OCR feladat sikertelen (nincs hibarészlet)";
						return {
							content: [{ type: "text" as const, text: `Az OCR feladat sikertelen: ${msg}` }],
							details: { error: "job_failed", jobId, message: msg } as Record<string, unknown>,
						};
					}
					// pending / running — keep polling
				}

				const jsonUrl = status.resultUrl?.jsonUrl;
				if (!jsonUrl) {
					return {
						content: [{ type: "text" as const, text: "Az OCR feladat befejeződött, de nem adott vissza eredmény-URL-t." }],
						details: { error: "missing_result_url", jobId } as Record<string, unknown>,
					};
				}

				const markdown = await fetchResult(jsonUrl, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
				if (!markdown.trim()) {
					return {
						content: [{ type: "text" as const, text: "Az OCR elkészült, de nem nyert ki szöveget a képből." }],
						details: { jobId, pages: 0 } as Record<string, unknown>,
					};
				}

				return {
					content: [{ type: "text" as const, text: markdown }],
					details: {
						jobId,
						pages: (markdown.match(/^---$/gm) || []).length + 1,
						textLength: markdown.length,
					} as Record<string, unknown>,
				};
			} catch (err) {
				logger.warn({ err, filePath }, "ocr_image: overall failed");
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Az OCR feldolgozás sikertelen: ${msg}` }],
					details: { error: "ocr_failed", filePath, message: msg } as Record<string, unknown>,
				};
			} finally {
				clearTimeout(totalTimer);
			}
		},
	});

	return [tool];
}
