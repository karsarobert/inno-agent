import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimePaths } from "../runtime.js";
import { applyBackupFiles, BACKUP_FORMAT_VERSION, collectBackupFiles } from "./state-backup.js";
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

		// Pre-existing "another student's" state on the target machine.
		write(dstPaths.workspaceDir, ".pub/masik_diak.cpp", "// more\n");
		write(join(dstPaths.dataDir, "workspaces"), "registry.json", JSON.stringify({
			workspaces: [{ id: "default", relPath: ".pub" }],
		}));
		write(dstPaths.sessionDir, "masik_session.jsonl", '{"role":"user"}\n');

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

		// The old workspace and old data were moved aside, not deleted.
		const trashDir = join(dstPaths.dataDir, ".restore-trash");
		expect(existsSync(trashDir)).toBe(true);
		const restoreDir = readdirSync(trashDir)[0];
		const trashEntries = readdirSync(join(trashDir, restoreDir));
		expect(trashEntries.some((e) => e.includes("workspace-.pub"))).toBe(true);
		expect(trashEntries.some((e) => e.includes("data-sessions"))).toBe(true);
		expect(existsSync(join(dstPaths.workspaceDir, ".pub", "masik_diak.cpp"))).toBe(false);
		// And the old session file is gone from the live dir (in the trash).
		expect(existsSync(join(dstPaths.sessionDir, "masik_session.jsonl"))).toBe(false);
	});
});
