import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceRegistry } from "./workspace-registry.js";

const testRoots: string[] = [];

afterEach(() => {
	for (const root of testRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("WorkspaceRegistry", () => {
	it("creates an English fallback name for a fresh temporary workspace", () => {
		const root = mkdtempSync(join(tmpdir(), "inno-workspace-registry-"));
		testRoots.push(root);
		const registry = new WorkspaceRegistry(join(root, "workspace"), join(root, "data"));

		registry.ensureBootstrapped();

		expect(registry.getWorkspace("tmp")?.name).toBe("Temporary Workspace");
	});
});
