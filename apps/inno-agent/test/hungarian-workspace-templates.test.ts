import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const hubRoot = resolve(testDirectory, "../../../..");
const templatesRoot = join(hubRoot, "workspace-templates");
const hanCharacter = /[\u4e00-\u9fff]/u;

interface LocalizationDocument {
	schemaVersion: number;
	locales: Record<string, { name?: unknown; description?: unknown; category?: unknown }>;
}

describe("Hungarian workspace templates", () => {
	it("provides Hungarian catalog metadata and an executable Hungarian agent instruction for every template", () => {
		const templateNames = readdirSync(templatesRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && existsSync(join(templatesRoot, entry.name, "preset.json")))
			.map((entry) => entry.name)
			.sort();

		expect(templateNames.length).toBeGreaterThan(0);
		for (const templateName of templateNames) {
			const templateDir = join(templatesRoot, templateName);
			const localization = JSON.parse(readFileSync(join(templateDir, "i18n.json"), "utf8")) as LocalizationDocument;
			expect(localization.schemaVersion).toBe(1);

			const hungarian = localization.locales.hu;
			expect(typeof hungarian?.name).toBe("string");
			expect(typeof hungarian?.description).toBe("string");
			expect(typeof hungarian?.category).toBe("string");
			expect(String(hungarian?.name)).not.toMatch(hanCharacter);
			expect(String(hungarian?.description)).not.toMatch(hanCharacter);
			expect(String(hungarian?.category)).not.toMatch(hanCharacter);

			const agent = readFileSync(join(templateDir, "locales", "hu", "agent.md"), "utf8");
			expect(agent.trim()).not.toBe("");
			expect(agent).not.toMatch(hanCharacter);
		}
	});
});
