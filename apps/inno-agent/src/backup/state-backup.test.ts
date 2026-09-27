import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimePaths } from "../runtime.js";
import { applyBackupFiles, BACKUP_FORMAT_VERSION, collectBackupFiles } from "./state-backup.js";
import { L3Memory } from "../memory/l3/l3-tools.js";
import { writeZip, readZip } from "./zip.js";

const testRoots: string[] = [];

afterEach(() => {
	for (const root of testRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makePaths(home: string): RuntimePaths {
	return {
		codeDir: join(home, "app"),
		configDir: join(home, "config"),
		configPath: join(home, "config", "config.json"),
		dataDir: join(home, "data"),
		learnerDataDir: join(home, "data", "learner"),
		sessionDir: join(home, "data", "sessions"),
		jobsDir: join(home, "data", "jobs"),
		l2DataDir: join(home, "data", "l2"),
		l3DataDir: join(home, "data", "l3"),
		skillsDir: join(home, "skills"),
		presetCacheDir: join(home, "data", "preset-cache"),
		workspaceDir: join(home, "workspace"),
		webDistDir: join(home, "app", "web", "dist"),
	};
}

function write(root: string, rel: string, content: string | Buffer): void {
	const abs = join(root, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content);
}

describe("collectBackupFiles", () => {
	it("collects the expected categories and excludes junk", async () => {
		const home = mkdtempSync(join(tmpdir(), "inno-backup-src-"));
		testRoots.push(home);
		const paths = makePaths(home);

		write(paths.configDir, "settings.json", JSON.stringify({ defaultModel: "InnoSpark3.0-35B" }));
		write(paths.configDir, "skills.json", JSON.stringify({ disabled: [] }));
		// config.json must never be exported (API keys / machine config).
		write(paths.configDir, "config.json", JSON.stringify({ providers: [{ apiKey: "SECRET" }] }));
		write(paths.learnerDataDir, "profile.json", JSON.stringify({ name: "Diák" }));
		write(paths.learnerDataDir, "events.jsonl", '{"event":"lesson_start"}\n');
		write(paths.sessionDir, "2026-08-22T08-00-00Z_a.jsonl", '{"role":"user"}\n');
		write(paths.sessionDir, "workspaces.json", JSON.stringify({ a: "tmp" }));
		write(join(paths.dataDir, "workspaces"), "registry.json", JSON.stringify({ workspaces: [] }));
		write(paths.jobsDir, "jobs.json", "[]");
		write(join(paths.dataDir, "runs"), "2026-08-22/run.json", JSON.stringify({ ok: true }));
		// L2 knowledge base: the notebook must be exported in full.
		write(paths.l2DataDir, "manifest.jsonl", '{"id":"l2src_x","title":"Kurzus"}\n');
		write(paths.l2DataDir, "wiki/entities/foo.md", "# Halmazok\n\nFontos jegyzetoldal.");
		write(paths.l2DataDir, "wiki/concepts/bar.md", "# Részhalmaz\n");
		write(paths.l2DataDir, "wiki/analysis/overview.md", "# Összefoglaló\n");
		write(paths.l2DataDir, "raw/uploads/kurzus.pdf", Buffer.from("%PDF-1.4 jegyzet"));
		write(paths.l2DataDir, "extracted/kurzus.md", "# kivonat");
		// workspace files + junk that must be excluded
		write(paths.workspaceDir, ".pub/main.cpp", "#include <iostream>");
		write(paths.workspaceDir, ".tmp/note.md", "jegyzet");
		write(paths.workspaceDir, "proj/main.py", "print('hi')");
		write(paths.workspaceDir, "proj/node_modules/pkg/index.js", "// junk");
		write(paths.workspaceDir, "proj/.git/config", "[core]");
		write(paths.workspaceDir, "proj/__pycache__/x.pyc", "junk");
		write(paths.workspaceDir, "proj/server.log", "junk log");

		const { files, manifest } = await collectBackupFiles(paths);

		expect(manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
		expect(files.has("config/settings.json")).toBe(true);
		expect(files.has("config/skills.json")).toBe(true);
		expect(files.has("config/config.json")).toBe(false); // never the machine config
		expect(files.has("learner/profile.json")).toBe(true);
		expect(files.has("learner/events.jsonl")).toBe(true);
		expect(files.has("sessions/2026-08-22T08-00-00Z_a.jsonl")).toBe(true);
		expect(files.has("sessions/workspaces.json")).toBe(true);
		expect(files.has("workspaces/registry.json")).toBe(true);
		expect(files.has("jobs/jobs.json")).toBe(true);
		expect(files.has("runs/2026-08-22/run.json")).toBe(true);
		// the notebook (L2 wiki + manifest + raw/extracted sources) is included
		expect(files.has("l2/manifest.jsonl")).toBe(true);
		expect(files.has("l2/wiki/entities/foo.md")).toBe(true);
		expect(files.has("l2/wiki/concepts/bar.md")).toBe(true);
		expect(files.has("l2/wiki/analysis/overview.md")).toBe(true);
		expect(files.has("l2/raw/uploads/kurzus.pdf")).toBe(true);
		expect(files.has("l2/extracted/kurzus.md")).toBe(true);
		expect(manifest.counts.l2).toBe(6); // manifest + 3 wiki + raw + extracted (nincs index.db itt)
		expect(files.has("workspace/.pub/main.cpp")).toBe(true);
		expect(files.has("workspace/.tmp/note.md")).toBe(true);
		expect(files.has("workspace/proj/main.py")).toBe(true);
		// exclusions
		expect(files.has("workspace/proj/node_modules/pkg/index.js")).toBe(false);
		expect(files.has("workspace/proj/.git/config")).toBe(false);
		expect(files.has("workspace/proj/__pycache__/x.pyc")).toBe(false);
		expect(files.has("workspace/proj/server.log")).toBe(false);
		expect(manifest.counts.workspace).toBe(3);
	});

	it("snapshots sqlite stores into readable databases", async () => {
		const home = mkdtempSync(join(tmpdir(), "inno-backup-sqlite-"));
		testRoots.push(home);
		const paths = makePaths(home);

		// Create real sqlite databases the way the app would.
		mkdirSync(paths.l3DataDir, { recursive: true });
		mkdirSync(paths.l2DataDir, { recursive: true });
		await import("node:sqlite").then(async (mod) => {
			const db = new mod.DatabaseSync(join(paths.l3DataDir, "memory.db"));
			db.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT); INSERT INTO chunks VALUES ('a', 'emlék')");
			db.close();
			const db2 = new mod.DatabaseSync(join(paths.l2DataDir, "index.db"));
			db2.exec("CREATE TABLE pages (path TEXT PRIMARY KEY); INSERT INTO pages VALUES ('wiki/entities/foo.md')");
			db2.close();
		});

		const { files, manifest } = await collectBackupFiles(paths);
		expect(files.has("l3/memory.db")).toBe(true);
		expect(files.has("l2/index.db")).toBe(true);
		expect(manifest.counts.l3).toBe(1);

		// The snapshot must be a valid, self-contained sqlite file with the data.
		await import("node:sqlite").then((mod) => {
			const tmp = join(home, "snap-check.db");
			writeFileSync(tmp, files.get("l3/memory.db")!);
			const db = new mod.DatabaseSync(tmp, { readOnly: true });
			const row = db.prepare("SELECT text FROM chunks WHERE id = 'a'").get() as { text?: string };
			expect(row.text).toBe("emlék");
			db.close();
		});
	});
});

describe("applyBackupFiles", () => {
	it("writes the backup into a fresh install and moves the old workspace aside", async () => {
		const src = mkdtempSync(join(tmpdir(), "inno-backup-src2-"));
		const dst = mkdtempSync(join(tmpdir(), "inno-backup-dst-"));
		testRoots.push(src, dst);
		const srcPaths = makePaths(src);
		const dstPaths = makePaths(dst);

		// Build the source state.
		write(srcPaths.configDir, "settings.json", JSON.stringify({ defaultModel: "InnoSpark3.0-35B" }));
		write(srcPaths.sessionDir, "s1.jsonl", '{"role":"user"}\n');
		write(srcPaths.learnerDataDir, "profile.json", JSON.stringify({ name: "Diák" }));
		write(srcPaths.workspaceDir, ".pub/main.cpp", "#include <iostream>\nint main() {}\n");
		write(join(srcPaths.dataDir, "workspaces"), "registry.json", JSON.stringify({
			workspaces: [{ id: "default", relPath: ".pub" }],
		}));
		// Notebook (L2) content must survive export → import.
		write(srcPaths.l2DataDir, "manifest.jsonl", '{"id":"l2src_x","title":"Kurzus","wikiPages":["wiki/entities/foo.md"]}\n');
		write(srcPaths.l2DataDir, "wiki/entities/foo.md", "# Halmazok\n\nFontos jegyzetoldal.");
		write(srcPaths.l2DataDir, "wiki/concepts/bar.md", "# Részhalmaz\n");
		write(srcPaths.l2DataDir, "raw/uploads/kurzus.pdf", "pdf-raw");

		// Pre-existing "another student's" state on the target machine.
		write(dstPaths.workspaceDir, ".pub/masik_diak.cpp", "// more\n");
		write(join(dstPaths.dataDir, "workspaces"), "registry.json", JSON.stringify({
			workspaces: [{ id: "default", relPath: ".pub" }],
		}));
		write(dstPaths.sessionDir, "masik_session.jsonl", '{"role":"user"}\n');
		// The target's own notebook must be moved aside, then replaced.
		write(dstPaths.l2DataDir, "wiki/entities/regi.md", "# Régi jegyzet\n");
		write(dstPaths.l2DataDir, "manifest.jsonl", '{"id":"l2src_old"}\n');

		const { files, manifest } = await collectBackupFiles(srcPaths);
		const archive = writeZip([
			{ path: "manifest.json", data: JSON.stringify(manifest) },
			...Array.from(files, ([path, data]) => ({ path, data })),
		]);

		const result = applyBackupFiles(dstPaths, new Map(readZip(archive).map((e) => [e.path, e.data])));

		// Restored files landed.
		expect(readFileSync(join(dstPaths.workspaceDir, ".pub", "main.cpp"), "utf-8")).toContain("int main()");
		expect(readFileSync(join(dstPaths.configDir, "settings.json"), "utf-8")).toContain("InnoSpark3.0-35B");
		expect(readFileSync(join(dstPaths.sessionDir, "s1.jsonl"), "utf-8")).toContain('"user"');
		expect(result.counts.workspace).toBe(1);
		// The notebook came back with the archive.
		expect(readFileSync(join(dstPaths.l2DataDir, "wiki", "entities", "foo.md"), "utf-8")).toContain("Halmazok");
		expect(readFileSync(join(dstPaths.l2DataDir, "wiki", "concepts", "bar.md"), "utf-8")).toContain("Részhalmaz");
		expect(readFileSync(join(dstPaths.l2DataDir, "manifest.jsonl"), "utf-8")).toContain("l2src_x");
		expect(readFileSync(join(dstPaths.l2DataDir, "raw", "uploads", "kurzus.pdf"), "utf-8")).toContain("pdf-raw");
		// The target's old notebook was moved aside, not deleted.
		expect(existsSync(join(dstPaths.l2DataDir, "wiki", "entities", "regi.md"))).toBe(false);
		expect(existsSync(join(dstPaths.l2DataDir, "manifest.jsonl"))).toBe(true);

		// The old workspace and old data were moved aside, not deleted.
		const trashDir = join(dstPaths.dataDir, ".restore-trash");
		expect(existsSync(trashDir)).toBe(true);
		const restoreDir = readdirSync(trashDir)[0];
		const trashEntries = readdirSync(join(trashDir, restoreDir));
		expect(trashEntries.some((e) => e.includes("workspace-.pub"))).toBe(true);
		expect(trashEntries.some((e) => e.includes("data-sessions"))).toBe(true);
		expect(trashEntries.some((e) => e.includes("data-l2"))).toBe(true);
		expect(existsSync(join(dstPaths.workspaceDir, ".pub", "masik_diak.cpp"))).toBe(false);
		// And the old session file is gone from the live dir (in the trash).
		expect(existsSync(join(dstPaths.sessionDir, "masik_session.jsonl"))).toBe(false);
	});

	it("restore releases the open L3 store and cleans its sidecars", async () => {
		const src = mkdtempSync(join(tmpdir(), "inno-backup-l3src-"));
		const dst = mkdtempSync(join(tmpdir(), "inno-backup-l3dst-"));
		testRoots.push(src, dst);
		const srcPaths = makePaths(src);
		const dstPaths = makePaths(dst);

		// Source: an L3 store that has actually indexed a session (WAL on).
		write(srcPaths.sessionDir, "s1.jsonl", '{"type":"message","timestamp":"2026-08-23T10:00:00.000Z","message":{"role":"user","content":"Fontos emlék a diszkrét matematikából"}}\n');
		const srcMemory = new L3Memory(srcPaths.l3DataDir, srcPaths.sessionDir);
		await srcMemory.backfill();
		expect(existsSync(join(srcPaths.l3DataDir, "memory.db"))).toBe(true);

		const { files, manifest } = await collectBackupFiles(srcPaths);
		expect(files.has("l3/memory.db")).toBe(true);
		const archive = writeZip([
			{ path: "manifest.json", data: JSON.stringify(manifest) },
			...Array.from(files, ([path, data]) => ({ path, data })),
		]);

		// Target: its own L3 store OPEN, exactly like a running server that
		// has already exercised cross-conversation recall.
		write(dstPaths.sessionDir, "masik.jsonl", '{"type":"message","timestamp":"2026-08-23T09:00:00.000Z","message":{"role":"user","content":"Másik gép egyik emléke"}}\n');
		const dstMemory = new L3Memory(dstPaths.l3DataDir, dstPaths.sessionDir);
		await dstMemory.backfill();
		const walPath = join(dstPaths.l3DataDir, "memory.db-wal");
		expect(existsSync(walPath)).toBe(true);

		const result = applyBackupFiles(dstPaths, new Map(readZip(archive).map((e) => [e.path, e.data])));

		expect(result.counts.l3).toBe(1);
		expect(existsSync(join(dstPaths.l3DataDir, "memory.db"))).toBe(true);
		// The target's open store was closed and its stale sidecar removed —
		// on Windows the locked -wal would otherwise abort the import (EPERM).
		expect(existsSync(walPath)).toBe(false);
		expect((dstMemory as unknown as { opened: boolean }).opened).toBe(false);
		// The next use reopens the restored database without error.
		await dstMemory.backfill();
		expect((dstMemory as unknown as { opened: boolean }).opened).toBe(true);
	});
});
