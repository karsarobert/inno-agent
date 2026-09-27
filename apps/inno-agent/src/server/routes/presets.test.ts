import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RuntimePaths } from "../../runtime.js";
import { handlePresetsRoutes } from "./presets.js";

// The route reads the local cache directory through the preset store; stub it so
// the test exercises routing behaviour, not the filesystem.
vi.mock("../../presets/preset-store.js", () => ({
	listPresets: () => [{ id: "ppt-creation", name: "PPT", description: "", category: "docs" }],
}));

function fakeRes() {
	const captured: { status: number; body: string }[] = [];
	const res = {
		writeHead: (status: number) => {
			captured.push({ status, body: "" });
		},
		end: (body?: string) => {
			const last = captured[captured.length - 1];
			if (last) last.body = body ?? "";
		},
	} as unknown as ServerResponse;
	return { res, captured };
}

async function call(url: string, disabled: boolean) {
	const { res, captured } = fakeRes();
	const ctx = {
		paths: {} as RuntimePaths,
		listPresetLibrary: vi.fn(async () => []),
		isContentHubDisabled: () => disabled,
	};
	const handled = await handlePresetsRoutes({} as IncomingMessage, res, "GET", url, ctx);
	return { handled, status: captured[0]?.status, body: captured[0]?.body };
}

describe("GET /api/presets with the content hub disabled", () => {
	it("returns an empty list when contentHub type is 'none'", async () => {
		const { handled, status, body } = await call("/api/presets", true);
		expect(handled).toBe(true);
		expect(status).toBe(200);
		expect(JSON.parse(body)).toEqual([]);
	});

	it("serves the bundled presets when the hub is enabled", async () => {
		const { status, body } = await call("/api/presets", false);
		expect(status).toBe(200);
		expect(JSON.parse(body)).toHaveLength(1);
	});

	it("keeps /api/preset-library card-free as well when disabled", async () => {
		const { handled, status, body } = await call("/api/preset-library?contentLocale=hu", true);
		expect(handled).toBe(true);
		expect(status).toBe(200);
		expect(JSON.parse(body)).toEqual([]);
	});
});
