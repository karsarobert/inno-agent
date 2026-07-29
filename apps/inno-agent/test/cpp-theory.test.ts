import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const hubRoot = resolve(testDirectory, "../../../..");
const templateDir = join(hubRoot, "workspace-templates", "cpp-theory");

function read(relativePath: string): string {
	return readFileSync(join(templateDir, relativePath), "utf8");
}

describe("C++ theory workspace template", () => {
	it("ships a Hungarian standalone theory workspace for the first C++ lesson", () => {
		const preset = JSON.parse(read("preset.json")) as { id: string; icon: string };
		expect(preset).toEqual({
			id: "cpp-theory",
			name: "C++ Theory",
			description: "A focused C++20 theory workspace with guided explanations, prediction questions, and small runnable examples.",
			category: "Programming",
			icon: "book-open",
		});

		const i18n = JSON.parse(read("i18n.json")) as { locales: Record<string, { name: string }> };
		expect(i18n.locales.hu.name).toBe("C++ Elmélet");

		const agent = read("locales/hu/agent.md");
		expect(agent).toContain("C++20-elméletet tanító oktató");
		expect(agent).toContain("C++ Tanulócoach");
		expect(agent).toContain("Ne készíts teljes beadandó");
		expect(agent).toContain("cpp-tutor");
		expect(agent).toContain("cpp-compile-run");

		const theoryPath = "locales/hu/lessons/00-algorithmic-thinking/theory.md";
		expect(existsSync(join(templateDir, theoryPath))).toBe(true);
		const theory = read(theoryPath);
		expect(theory).toContain("Algoritmikus gondolkodás");
		expect(theory).toContain("C++Programming.pdf");
		expect(theory).toContain("Modern C++ előretekintő");

		for (const skillPath of [
			"locales/hu/.skills/cpp-tutor/SKILL.md",
			"locales/hu/.skills/cpp-compile-run/SKILL.md",
		]) {
			expect(existsSync(join(templateDir, skillPath))).toBe(true);
		}
	});
});
