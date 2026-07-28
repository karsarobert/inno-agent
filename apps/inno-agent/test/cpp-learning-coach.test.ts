import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const hubRoot = resolve(testDirectory, "../../../..");
const templateDir = join(hubRoot, "workspace-templates", "cpp-learning-coach");
const hanCharacter = /[\u4e00-\u9fff]/u;

function read(relativePath: string): string {
	return readFileSync(join(templateDir, relativePath), "utf8");
}

describe("C++ learning coach workspace template", () => {
	it("ships Hungarian catalog metadata, guided learning instructions, and core skills", () => {
		const localization = JSON.parse(read("i18n.json")) as {
			schemaVersion: number;
			locales: Record<string, { name: string; description: string; category: string }>;
		};
		expect(localization.schemaVersion).toBe(1);
		expect(localization.locales.hu).toMatchObject({
			name: "C++ Tanulócoach",
			category: "Programozás",
		});
		expect(localization.locales.hu.description).not.toMatch(hanCharacter);

		const agent = read("locales/hu/agent.md");
		expect(agent).toContain("C++20");
		expect(agent).toContain("ne add meg rögtön a teljes megoldást");
		expect(agent).not.toMatch(hanCharacter);

		for (const skillPath of [
			"locales/hu/.skills/cpp-tutor/SKILL.md",
			"locales/hu/.skills/cpp-compile-run/SKILL.md",
			"locales/hu/.skills/cpp-code-review/SKILL.md",
			"locales/hu/.skills/cpp-exercise-builder/SKILL.md",
		]) {
			expect(existsSync(join(templateDir, skillPath))).toBe(true);
			expect(read(skillPath)).not.toMatch(hanCharacter);
		}
	});

	it("provides a CMake starter and progressively structured beginner exercises", () => {
		expect(read("starter/CMakeLists.txt")).toContain("CXX_STANDARD 20");
		expect(read("starter/src/main.cpp")).toContain("int main()");

		for (const exercisePath of [
			"exercises/00-basics/01-hello-and-variables.md",
			"exercises/01-control-flow/01-temperature-check.md",
			"exercises/02-functions/01-number-statistics.md",
		]) {
			const exercise = read(exercisePath);
			expect(exercise).toContain("## Feladat");
			expect(exercise).toContain("## Ellenőrzési szempontok");
			expect(exercise).not.toMatch(hanCharacter);
		}
	});

	it("provides local, data-minimal progress tracking and teacher-report tools", () => {
		for (const skillPath of [
			"locales/hu/.skills/cpp-progress-tracker/SKILL.md",
			"locales/hu/.skills/cpp-submission-review/SKILL.md",
			"locales/hu/.skills/teacher-report-generator/SKILL.md",
		]) {
			expect(existsSync(join(templateDir, skillPath))).toBe(true);
			expect(read(skillPath)).not.toMatch(hanCharacter);
		}

		const progress = JSON.parse(read("progress.json")) as {
			schemaVersion: number;
			localOnly: boolean;
			studentAlias: string | null;
			modules: Record<string, unknown>;
			competencies: Record<string, unknown>;
		};
		expect(progress).toMatchObject({ schemaVersion: 1, localOnly: true, studentAlias: null });
		expect(progress.modules).toBeTypeOf("object");
		expect(progress.competencies).toBeTypeOf("object");

		const reportTemplate = read("locales/hu/templates/teacher-report.md");
		expect(reportTemplate).toContain("## Teljesített modulok");
		expect(reportTemplate).toContain("## Következő javasolt lépés");
		expect(reportTemplate).toContain("A tanuló által jóváhagyott összesítés");
	});
});
