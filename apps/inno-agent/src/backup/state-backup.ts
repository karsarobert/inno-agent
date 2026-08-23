/**
 * State backup/restore for the whole student state.
 *
 * Export collects everything the student needs into one in-memory file map
 * (serialized as a ZIP by backup/zip.ts):
 *   - config/settings.json, config/skills.json     (user preferences)
 *   - learner/*                                    (learner profile + events)
 *   - sessions/*.jsonl + workspaces.json           (conversations + bindings)
 *   - l3/memory.db, l2/*                           (long-term memory + the full
 *     L2 knowledge base: wiki pages — the notebook —, source manifest, raw
 *     uploads, extracted text, and the search index)
 *   - workspaces/registry.json, jobs/jobs.json, runs/**
 *   - workspace/**                                 (all student files)
 *
 * Machine-specific / credential data is deliberately EXCLUDED: config.json
 * (providers, API keys, ports, content hub), auth.json, sandbox.json, server
 * logs, channel state and the re-downloadable preset cache.
 *
 * SQLite stores are snapshotted with `VACUUM INTO` so the export is consistent
 * even while the server is running; on runtimes without node:sqlite the files
 * are copied verbatim as a fallback.
 *
 * Restore is non-destructive: the current workspace directories and the data
 * subdirectories being replaced are first MOVED ASIDE into
 * `dataDir/.restore-trash/restore-<ts>/` (never deleted), then the backup
 * files are written fresh. The L2 singleton is closed first so the next access
 * reopens the restored index.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { RuntimePaths } from "../runtime.js";
import { ensureDir, readJson } from "../storage/file-store.js";
import { resetL2Memory } from "../memory/l2/l2-memory.js";
import { closeAllL3Stores } from "../memory/l3/l3-tools.js";
import { logger } from "../logger.js";

export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
	formatVersion: number;
	appVersion: string;
	createdAt: string;
	counts: Record<string, number>;
	totalBytes: number;
}

export interface BackupCollectResult {
	files: Map<string, Buffer>;
	manifest: BackupManifest;
}

export interface RestoreResult {
	counts: Record<string, number>;
	movedAside: string[];
	notes: string[];
}

const MAX_COLLECT_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB safety cap for exports

/** Directory/file names never included from the workspace tree. */
const WORKSPACE_EXCLUDED_NAMES = new Set([
	"node_modules",
	".git",
	".venv",
	"venv",
	"__pycache__",
	".next",
	".cache",
	".DS_Store",
	".inno-restore-trash",
]);

const WORKSPACE_EXCLUDED_EXTENSIONS = new Set([".log"]);

/** Data subdirectories replaced wholesale on restore (moved aside first). */
const REPLACED_DATA_DIRS = ["sessions", "learner", "l3", "l2", "workspaces", "jobs", "runs"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function appVersion(): string {
	try {
		const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
		return pkg.version ?? "unknown";
	} catch {
		return "unknown";
	}
}

/**
 * Walk a directory tree without following symlinks. `visit` receives the
 * relative POSIX path of every regular file.
 */
function walkDir(
	root: string,
	visit: (rel: string) => void,
	opts: { excludedNames?: Set<string>; excludedExtensions?: Set<string> } = {},
): void {
	if (!existsSync(root)) return;
	const stack: string[] = [""];
	while (stack.length > 0) {
		const rel = stack.pop()!;
		const abs = join(root, rel);
		let st;
		try {
			st = lstatSync(abs);
		} catch {
			continue;
		}
		if (st.isSymbolicLink()) continue; // never follow symlinks out of the tree
		if (!st.isDirectory()) {
			const ext = extname(rel).toLowerCase();
			if (opts.excludedExtensions?.has(ext)) continue;
			visit(rel);
			continue;
		}
		let names: string[];
		try {
			names = readdirSync(abs);
		} catch {
			continue;
		}
		for (const name of names) {
			const childRel = rel ? `${rel}/${name}` : name;
			const segments = childRel.split("/");
			if (opts.excludedNames && segments.some((s) => opts.excludedNames!.has(s))) continue;
			stack.push(childRel);
		}
	}
}

/**
 * Consistent SQLite snapshot via `VACUUM INTO` (safe while the app holds the
 * database open). Falls back to a plain copy when node:sqlite is unavailable
 * or the snapshot fails — the WAL files are included in that case.
 */
async function snapshotSqlite(dbPath: string): Promise<Buffer | null> {
	if (!existsSync(dbPath) || !statSync(dbPath).isFile()) return null;
	const out = join(tmpdir(), `inno-snap-${randomUUID()}.db`);
	try {
		const mod = (await import("node:sqlite")) as unknown as {
			DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
		};
		const db = new mod.DatabaseSync(dbPath);
		try {
			db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
		} finally {
			db.close();
		}
		return readFileSync(out);
	} catch (err) {
		logger.warn({ err }, `[backup] VACUUM INTO failed for ${dbPath} — copying file verbatim`);
		return readFileSync(dbPath);
	} finally {
		try {
			rmSync(out, { force: true });
		} catch {
			// best effort
		}
	}
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function collectBackupFiles(paths: RuntimePaths, opts: { maxBytes?: number } = {}): Promise<BackupCollectResult> {
	const maxBytes = opts.maxBytes ?? MAX_COLLECT_BYTES;
	const files = new Map<string, Buffer>();
	const counts: Record<string, number> = {};
	let total = 0;

	const add = (category: string, relPath: string, data: Buffer): void => {
		const key = `${category}/${relPath}`;
		files.set(key, data);
		counts[category] = (counts[category] ?? 0) + 1;
		total += data.length;
		if (total > maxBytes) {
			throw new Error(`A mentés mérete meghaladná a ${Math.round(maxBytes / 1024 / 1024)} MB-os korlátot`);
		}
	};

	const addFileIfExists = (category: string, absPath: string, relPath: string): void => {
		if (existsSync(absPath) && statSync(absPath).isFile()) {
			add(category, relPath, readFileSync(absPath));
		}
	};

	// --- config (user preferences only — never config.json/auth.json) ---
	addFileIfExists("config", join(paths.configDir, "settings.json"), "settings.json");
	addFileIfExists("config", join(paths.configDir, "skills.json"), "skills.json");

	// --- learner profile + events ---
	addFileIfExists("learner", join(paths.learnerDataDir, "profile.json"), "profile.json");
	addFileIfExists("learner", join(paths.learnerDataDir, "events.jsonl"), "events.jsonl");

	// --- sessions (conversations + session→workspace bindings) ---
	if (existsSync(paths.sessionDir)) {
		for (const f of readdirSync(paths.sessionDir)) {
			if (f.endsWith(".jsonl")) addFileIfExists("sessions", join(paths.sessionDir, f), f);
		}
		addFileIfExists("sessions", join(paths.sessionDir, "workspaces.json"), "workspaces.json");
	}

	// --- long-term memory (L3) + wiki index (L2) — consistent snapshots ---
	const l3 = await snapshotSqlite(join(paths.l3DataDir, "memory.db"));
	if (l3) add("l3", "memory.db", l3);
	const l2 = await snapshotSqlite(join(paths.l2DataDir, "index.db"));
	if (l2) add("l2", "index.db", l2);

	// --- L2 knowledge base content (the notebook) ---
	// The wiki pages the agent writes, the source manifest, uploaded raw
	// documents and their extracted text are all student content and must
	// survive export/import. The live index.db (and its WAL/SHM sidecars) is
	// NOT walked — index.db is snapshotted consistently above, and a copy of
	// the mid-write database would be useless anyway.
	walkDir(
		paths.l2DataDir,
		(rel) => addFileIfExists("l2", join(paths.l2DataDir, rel), rel),
		{ excludedNames: new Set(["index.db", "index.db-wal", "index.db-shm"]) },
	);

	// --- workspace registry ---
	addFileIfExists("workspaces", join(paths.dataDir, "workspaces", "registry.json"), "registry.json");

	// --- scheduled jobs ---
	addFileIfExists("jobs", join(paths.jobsDir, "jobs.json"), "jobs.json");

	// --- Practice Lab run records ---
	walkDir(join(paths.dataDir, "runs"), (rel) => addFileIfExists("runs", join(paths.dataDir, "runs", rel), rel));

	// --- workspace files (all student files, junk excluded) ---
	walkDir(
		paths.workspaceDir,
		(rel) => addFileIfExists("workspace", join(paths.workspaceDir, rel), rel),
		{ excludedNames: WORKSPACE_EXCLUDED_NAMES, excludedExtensions: WORKSPACE_EXCLUDED_EXTENSIONS },
	);

	const manifest: BackupManifest = {
		formatVersion: BACKUP_FORMAT_VERSION,
		appVersion: appVersion(),
		createdAt: new Date().toISOString(),
		counts,
		totalBytes: total,
	};

	return { files, manifest };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function mapArchivePath(paths: RuntimePaths, key: string): string | null {
	const slash = key.indexOf("/");
	const category = slash > 0 ? key.slice(0, slash) : key;
	const rest = slash > 0 ? key.slice(slash + 1) : "";
	if (!rest) return null;

	switch (category) {
		case "config":
			return rest === "settings.json" || rest === "skills.json" ? join(paths.configDir, rest) : null;
		case "learner":
			return join(paths.learnerDataDir, rest);
		case "sessions":
			return join(paths.sessionDir, rest);
		case "l3":
			return rest === "memory.db" ? join(paths.l3DataDir, rest) : null;
		case "l2":
			if (rest === "index.db" || rest === "manifest.jsonl") return join(paths.l2DataDir, rest);
			// The notebook itself: wiki pages, uploaded sources, extracted text.
			if (rest.startsWith("wiki/") || rest.startsWith("raw/") || rest.startsWith("extracted/")) {
				return join(paths.l2DataDir, rest);
			}
			return null;
		case "workspaces":
			return rest === "registry.json" ? join(paths.dataDir, "workspaces", rest) : null;
		case "jobs":
			return rest === "jobs.json" ? join(paths.jobsDir, rest) : null;
		case "runs":
			return join(paths.dataDir, "runs", rest);
		case "workspace": {
			const target = resolve(join(paths.workspaceDir, rest));
			// Defense in depth: normalized zip paths cannot contain "..", but
			// never write outside the workspace root regardless.
			if (target !== resolve(paths.workspaceDir) && !target.startsWith(resolve(paths.workspaceDir) + sep)) return null;
			return target;
		}
		default:
			return null;
	}
}

/**
 * Apply a backup's files onto the running install. Non-destructive: current
 * workspace directories (from the registry) and the replaced data
 * subdirectories are moved aside into `dataDir/.restore-trash/restore-<ts>/`.
 */
export function applyBackupFiles(paths: RuntimePaths, files: Map<string, Buffer>): RestoreResult {
	const notes: string[] = [];

	// Close the L2/L3 singletons so the next access reopens the restored
	// stores. Releasing the L3 handle is REQUIRED on Windows: its open
	// memory.db-wal would otherwise be locked, and deleting the stale sidecar
	// during restore would abort the whole import with EPERM.
	resetL2Memory(paths.l2DataDir);
	closeAllL3Stores();

	const trashDir = join(paths.dataDir, ".restore-trash", `restore-${Date.now()}`);
	ensureDir(trashDir);
	const movedAside: string[] = [];

	const moveAside = (absPath: string, label: string): boolean => {
		if (!existsSync(absPath)) return true;
		try {
			renameSync(absPath, join(trashDir, label.replace(/[/\\]/g, "_")));
			movedAside.push(label);
			return true;
		} catch (err) {
			notes.push(`Nem sikerült félretenni a régi állapotot (${label}): ${err instanceof Error ? err.message : String(err)} — felülírás módban folytatom.`);
			return false;
		}
	};

	// 1. Move aside the CURRENT machine's registered workspaces (read before
	//    the registry is overwritten), so a restore gives a clean workspace.
	const currentRegistry = readJson<{ workspaces?: Array<{ relPath?: string }> }>(
		join(paths.dataDir, "workspaces", "registry.json"),
		{ workspaces: [] },
	);
	for (const w of currentRegistry.workspaces ?? []) {
		const relPath = w.relPath;
		if (!relPath || relPath === ".") continue;
		const target = resolve(join(paths.workspaceDir, relPath));
		if (target !== resolve(paths.workspaceDir) && !target.startsWith(resolve(paths.workspaceDir) + sep)) continue;
		moveAside(target, `workspace-${relPath}`);
	}

	// 2. Move aside the data subdirectories being replaced.
	for (const cat of REPLACED_DATA_DIRS) {
		moveAside(join(paths.dataDir, cat), `data-${cat}`);
	}

	// 3. Write the restored files.
	const counts: Record<string, number> = {};
	let sqliteFiles: string[] = [];
	for (const [key, data] of files) {
		const target = mapArchivePath(paths, key);
		if (!target) continue; // manifest.json and unknown entries are skipped
		ensureDir(dirname(target));
		writeFileSync(target, data);
		const category = key.slice(0, key.indexOf("/"));
		counts[category] = (counts[category] ?? 0) + 1;
		if (key === "l3/memory.db" || key === "l2/index.db") sqliteFiles.push(target);
	}

	// 4. Drop stale WAL/SHM sidecars — the restored snapshot is authoritative.
	// Best-effort: a lingering OS lock (antivirus, transient handle) must not
	// abort the whole restore; a leftover sidecar is surfaced as a note.
	for (const db of sqliteFiles) {
		for (const suffix of ["-wal", "-shm"]) {
			try {
				rmSync(`${db}${suffix}`, { force: true });
			} catch (err) {
				notes.push(
					`Nem sikerült törölni a régi ${suffix.slice(1)} oldalfájlt (${db}): ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
	}

	logger.info(
		{ movedAside, counts },
		`[backup] state restored from archive (old state moved to ${trashDir})`,
	);

	return { counts, movedAside, notes };
}
