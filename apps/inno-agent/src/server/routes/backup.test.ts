import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { RuntimePaths } from "../../runtime.js";
import { handleBackupRoutes } from "./backup.js";

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

function fakeReq(headers: Record<string, string> = {}) {
	return { headers } as unknown as IncomingMessage;
}

async function call(url: string, opts: { busy?: boolean; headers?: Record<string, string> } = {}) {
	const { res, captured } = fakeRes();
	const handled = await handleBackupRoutes(
		fakeReq(opts.headers),
		res,
		"POST",
		url,
		{ paths: {} as RuntimePaths, hasActiveStreams: () => opts.busy === true },
	);
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
