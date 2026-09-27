import { writeFileSync } from "node:fs";
import type { IncomingMessage as HttpReq, ServerResponse } from "node:http";
import { join } from "node:path";
import {
	applyBackupFiles,
	BACKUP_FORMAT_VERSION,
	type BackupManifest,
	collectBackupFiles,
} from "../../backup/state-backup.js";
import { readZip, writeZip } from "../../backup/zip.js";
import { logger } from "../../logger.js";
import type { RuntimePaths } from "../../runtime.js";
import { ensureDir } from "../../storage/file-store.js";
import { json, readBody } from "../http-helpers.js";

export interface BackupRouteContext {
	paths: RuntimePaths;
	/** True while any session has an active turn — restore must wait for those. */
	hasActiveStreams: () => boolean;
	/**
	 * Ask the HTTP server to close and the process to exit. Injected by server.ts
	 * because it owns the listener; /api/shutdown answers first, then stops.
	 */
	requestShutdown?: () => void;
}

/**
 * Assemble the full-state archive (manifest + every collected file) that both the
 * download endpoint and the save-before-shutdown path hand out.
 */
async function buildStateArchive(paths: RuntimePaths): Promise<Buffer> {
	const result = await collectBackupFiles(paths);
	return writeZip([
		{ path: "manifest.json", data: JSON.stringify(result.manifest, null, 2) },
		...Array.from(result.files, ([path, data]) => ({ path, data })),
	]);
}

/** Timestamp for archive filenames: 2026-09-27-20-26-54 (sortable, no colons). */
function archiveStamp(): string {
	return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/** Read a raw request body with a hard size cap (the zip upload path). */
function readRawBody(req: HttpReq, maxBytes: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let tooLarge = false;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxBytes) {
				tooLarge = true;
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (tooLarge) {
				reject(new Error(`Body exceeds ${maxBytes} bytes`));
				return;
			}
			resolve(Buffer.concat(chunks));
		});
		req.on("error", reject);
	});
}

/**
 * /api/backup route domain: export the whole learner state (sessions, workspaces,
 * memory, config) as a single zip and restore it. Extracted from server.ts when
 * porting the pre-v0.6.x line onto the v0.6.x route layout — behaviour unchanged.
 */
export async function handleBackupRoutes(
	req: HttpReq,
	res: ServerResponse,
	method: string,
	url: string,
	ctx: BackupRouteContext,
): Promise<boolean> {
	const { paths, hasActiveStreams } = ctx;

	if (method === "GET" && url === "/api/backup/export") {
		try {
			const archive = await buildStateArchive(paths);
			const filename = `inno-agent-mentes-${archiveStamp()}.zip`;
			res.writeHead(200, {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Content-Length": archive.length,
			});
			res.end(archive);
		} catch (err) {
			json(res, 500, { error: `A mentés nem sikerült: ${err instanceof Error ? err.message : String(err)}` });
		}
		return true;
	}

	if (method === "POST" && url === "/api/backup/import") {
		const MAX_IMPORT_BYTES = 512 * 1024 * 1024; // 512 MB
		const declaredLength = Number(req.headers["content-length"] ?? 0);
		if (declaredLength > MAX_IMPORT_BYTES) {
			json(res, 413, { error: "A mentési fájl túl nagy (max. 512 MB)." });
			return true;
		}
		if (hasActiveStreams()) {
			json(res, 409, {
				code: "busy",
				error: "Egy feladat éppen fut — a visszaállítás csak annak befejezése után lehetséges.",
			});
			return true;
		}
		try {
			const body = await readRawBody(req, MAX_IMPORT_BYTES);
			if (body.length === 0) {
				json(res, 400, { error: "Üres fájl." });
				return true;
			}
			const entries = readZip(body);
			const files = new Map<string, Buffer>();
			let manifest: BackupManifest | null = null;
			for (const entry of entries) {
				if (entry.path === "manifest.json") {
					try {
						manifest = JSON.parse(entry.data.toString("utf-8")) as BackupManifest;
					} catch {
						manifest = null;
					}
					continue;
				}
				files.set(entry.path, entry.data);
			}
			if (!manifest || manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
				json(res, 400, { error: "A fájl nem Inno Agent mentés, vagy nem támogatott formátumú." });
				return true;
			}
			const result = applyBackupFiles(paths, files);
			logger.info({ counts: result.counts, movedAside: result.movedAside }, "[backup] state restored via /api/backup/import");
			json(res, 200, {
				status: "restored",
				createdAt: manifest.createdAt,
				counts: result.counts,
				movedAside: result.movedAside,
				notes: result.notes,
			});
		} catch (err) {
			json(res, 400, { error: `A visszaállítás nem sikerült: ${err instanceof Error ? err.message : String(err)}` });
		}
		return true;
	}

	// --- Save & stop: the settings UI asks the app to quit. With
	// { saveBeforeExit: true } the full state is written to <dataDir>/exports/
	// first — the same archive the download produces — so it can be picked up
	// later (e.g. handed in at the end of a lab). Lives in this module because it
	// reuses the archive assembly; /api/settings stays about settings. ---
	if (method === "POST" && url === "/api/shutdown") {
		let savedBackup: string | null = null;
		const body = (await readBody(req).catch(() => ({}))) as { saveBeforeExit?: unknown };
		if (body.saveBeforeExit === true) {
			try {
				const archive = await buildStateArchive(paths);
				const exportsDir = join(paths.dataDir, "exports");
				ensureDir(exportsDir);
				savedBackup = join(exportsDir, `inno-agent-mentes-${archiveStamp()}.zip`);
				writeFileSync(savedBackup, archive);
				logger.info({ path: savedBackup, bytes: archive.length }, "[backup] state saved before shutdown");
			} catch (err) {
				logger.warn({ err }, "[backup] save-before-shutdown failed — stopping anyway");
			}
		}
		// Answer first so the UI can show the result, then let server.ts stop.
		json(res, 200, { status: "stopping", savedBackup });
		ctx.requestShutdown?.();
		return true;
	}

	return false;
}
