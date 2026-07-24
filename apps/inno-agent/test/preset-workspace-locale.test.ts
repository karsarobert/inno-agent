import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceRegistry } from "../src/workspace/workspace-registry.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("localized preset workspaces", () => {
	it("keeps each content locale in its own preset workspace without replacing the earlier locale", () => {
		const root = mkdtempSync(join(tmpdir(), "inno-preset-locale-"));
		tempDirs.push(root);
		const registry = new WorkspaceRegistry(join(root, "workspace"), join(root, "data"));

		const english = registry.ensurePresetWorkspace("ielts-prep", "IELTS Preparation", "en");
		const hungarian = registry.ensurePresetWorkspace("ielts-prep", "IELTS-felkészítő", "hu");

		expect(english.created).toBe(true);
		expect(hungarian.created).toBe(true);
		expect(hungarian.ws.id).not.toBe(english.ws.id);
		expect(hungarian.ws.name).toBe("IELTS-felkészítő");
		expect(hungarian.ws.relPath).not.toBe(english.ws.relPath);
		expect(registry.ensurePresetWorkspace("ielts-prep", "IELTS-felkészítő", "hu").created).toBe(false);
	});
});
