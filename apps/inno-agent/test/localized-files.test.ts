import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { materializeLocalizedContent } from "../src/content-source/localized-files.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { source: string; target: string } {
	const root = mkdtempSync(join(tmpdir(), "inno-locale-test-"));
	roots.push(root);
	const source = join(root, "source");
	const target = join(root, "target");
	mkdirSync(join(source, "locales", "hu"), { recursive: true });
	mkdirSync(join(source, "locales", "en"), { recursive: true });
	mkdirSync(join(source, "references"), { recursive: true });
	writeFileSync(join(source, "SKILL.md"), "canonical");
	writeFileSync(join(source, "references", "guide.md"), "shared guide");
	writeFileSync(join(source, "locales", "en", "SKILL.md"), "english");
	writeFileSync(join(source, "locales", "hu", "SKILL.md"), "magyar");
	return { source, target };
}

describe("localized content materialization", () => {
	it("overlays the requested Hungarian locale while retaining shared files", () => {
		const { source, target } = fixture();
		const result = materializeLocalizedContent(source, target, "SKILL.md", "hu");
		expect(result).toEqual({ locale: "hu", fallback: false });
		expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("magyar");
		expect(readFileSync(join(target, "references", "guide.md"), "utf8")).toBe("shared guide");
	});

	it("uses English before the canonical marker when Hungarian is unavailable", () => {
		const { source, target } = fixture();
		rmSync(join(source, "locales", "hu"), { recursive: true });
		const result = materializeLocalizedContent(source, target, "SKILL.md", "hu");
		expect(result).toEqual({ locale: "en", fallback: true });
		expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("english");
	});
});
