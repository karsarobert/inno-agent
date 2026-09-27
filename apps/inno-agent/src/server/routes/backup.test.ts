import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readZip } from "../../backup/zip.js";
import type { RuntimePaths } from "../../runtime.js";
import { handleBackupRoutes } from "./backup.js";

const testRoots: string[] = [];

afterEach(() => {
	for (const root of testRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Minimal full RuntimePaths so the collector can run against a temp home. */
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

function fakeRes() {
	const captured: { status: number; body: string }[] = [];
	const res = {
		writeHead: (status: number) => {
			captured.push({ status, body: "" });
		},
		end: (body?: string | Buffer) => {
			const last = captured[captured.length - 1];
			if (last) last.body = Buffer.isBuffer(body) ? body.toString("utf-8") : (body ?? "");
		},
	} as unknown as ServerResponse;
	return { res, captured };
}

/** A request stand-in: a readable stream (what readBody/readRawBody consume) + headers. */
function fakeReq(body?: unknown, headers: Record<string, string> = {}) {
	const stream = body === undefined ? new Readable({ read() {} }) : Readable.from([JSON.stringify(body)]);
	if (body === undefined) stream.push(null);
	return Object.assign(stream, { headers }) as unknown as IncomingMessage;
}

async function call(
	url: string,
	opts: {
		method?: string;
		body?: unknown;
		busy?: boolean;
		headers?: Record<string, string>;
		paths?: RuntimePaths;
		requestShutdown?: () => void;
	} = {},
) {
	const { res, captured } = fakeRes();
	const handled = await handleBackupRoutes(fakeReq(opts.body, opts.headers), res, opts.method ?? "POST", url, {
		paths: opts.paths ?? ({} as RuntimePaths),
		hasActiveStreams: () => opts.busy === true,
		requestShutdown: opts.requestShutdown,
	});
	return { handled, status: captured[0]?.status, body: captured[0]?.body };
}

describe("backup import guards", () => {
	it("refuses the restore while a chat turn is active", async () => {
		const { handled, status, body } = await call("/api/backup/import", { busy: true });
		expect(handled).toBe(true);
		expect(status).toBe(409);
		expect(JSON.parse(body).code).toBe("busy");
	});

	it("refuses an upload above the size cap before reading the body", async () => {
		const { handled, status } = await call("/api/backup/import", {
			headers: { "content-length": String(600 * 1024 * 1024) },
		});
		expect(handled).toBe(true);
		expect(status).toBe(413);
	});

	it("leaves unrelated URLs to the other route handlers", async () => {
		const { handled } = await call("/api/settings");
		expect(handled).toBe(false);
	});
});

describe("save & shutdown", () => {
	it("writes the full state into <dataDir>/exports before stopping", async () => {
		const home = mkdtempSync(join(tmpdir(), "inno-shutdown-"));
		testRoots.push(home);
		const paths = makePaths(home);
		mkdirSync(paths.sessionDir, { recursive: true });
		writeFileSync(join(paths.sessionDir, "sess-1.jsonl"), '{"type":"message"}\n');

		const requestShutdown = vi.fn();
		const { handled, status, body } = await call("/api/shutdown", {
			body: { saveBeforeExit: true },
			paths,
			requestShutdown,
		});

		expect(handled).toBe(true);
		expect(status).toBe(200);
		const payload = JSON.parse(body) as { status: string; savedBackup: string | null };
		expect(payload.status).toBe("stopping");
		expect(payload.savedBackup).toBeTruthy();
		const saved = payload.savedBackup as string;
		expect(saved.startsWith(join(paths.dataDir, "exports"))).toBe(true);
		expect(existsSync(saved)).toBe(true);

		// The archive must be the same shape the download endpoint produces.
		const names = readZip(readFileSync(saved)).map((entry) => entry.path);
		expect(names).toContain("manifest.json");
		expect(names).toContain("sessions/sess-1.jsonl");

		expect(requestShutdown).toHaveBeenCalledTimes(1);
	});

	it("stops anyway when the state cannot be saved, and reports savedBackup: null", async () => {
		const requestShutdown = vi.fn();
		const { status, body } = await call("/api/shutdown", {
			body: { saveBeforeExit: true },
			paths: {} as RuntimePaths,
			requestShutdown,
		});
		expect(status).toBe(200);
		expect((JSON.parse(body) as { savedBackup: string | null }).savedBackup).toBeNull();
		expect(requestShutdown).toHaveBeenCalledTimes(1);
	});

	it("stops without saving when the caller does not ask for a backup", async () => {
		const { status, body } = await call("/api/shutdown", { requestShutdown: () => {} });
		expect(status).toBe(200);
		expect(JSON.parse(body)).toEqual({ status: "stopping", savedBackup: null });
	});
});
