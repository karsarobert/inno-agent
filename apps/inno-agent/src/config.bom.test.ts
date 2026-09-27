import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

/**
 * PowerShell 5.1's `Set-Content -Encoding UTF8` writes a byte-order mark, which
 * makes JSON.parse reject the file. A BOM'd config therefore used to fail every
 * /api/* request with a 500 while /health kept answering 200, so this is worth a
 * regression test of its own.
 */
const VALID_CONFIG = JSON.stringify({
	defaultProvider: "dummy",
	defaultModel: "dummy-model",
	providers: {
		dummy: {
			baseUrl: "http://127.0.0.1:9",
			apiKey: "dummy-key",
			api: "openai-completions",
			models: [{ id: "dummy-model" }],
		},
	},
});

describe("loadConfig with a UTF-8 BOM", () => {
	const dir = mkdtempSync(join(tmpdir(), "inno-config-bom-"));

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("parses a config.json written with a leading U+FEFF", () => {
		writeFileSync(join(dir, "config.json"), `\uFEFF${VALID_CONFIG}`, "utf-8");
		expect(() => loadConfig(dir)).not.toThrow();
	});

	it("reads the same config with and without a BOM", () => {
		writeFileSync(join(dir, "config.json"), VALID_CONFIG, "utf-8");
		const withoutBom = loadConfig(dir);
		writeFileSync(join(dir, "config.json"), `\uFEFF${VALID_CONFIG}`, "utf-8");
		expect(loadConfig(dir)).toEqual(withoutBom);
	});

	it("still rejects genuinely broken JSON", () => {
		writeFileSync(join(dir, "config.json"), "\uFEFF{ nope", "utf-8");
		expect(() => loadConfig(dir)).toThrow(/Failed to load Inno config/);
	});
});
