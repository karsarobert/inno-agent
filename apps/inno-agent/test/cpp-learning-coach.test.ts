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
		expect(agent).toContain("Minden új lecke előtt");
		expect(agent).toContain("cpp-progress-tracker");
		expect(agent).toContain("cpp-submission-review");
		expect(agent).toContain("teacher-report-generator");
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

		const tutorSkill = read("locales/hu/.skills/cpp-tutor/SKILL.md");
		expect(tutorSkill).toContain("create_practice_lab");
		expect(tutorSkill).toContain("submissions/");
		expect(tutorSkill).toContain("ne a chatben kiírt teljes kódvázzal");
		expect(tutorSkill).toContain("Megírtam");
	});

	it("provides a CMake starter and progressively structured beginner exercises", () => {
		expect(read("starter/CMakeLists.txt")).toContain("CXX_STANDARD 20");
		expect(read("starter/src/main.cpp")).toContain("int main()");

		const coursePlan = read("kurzus-terv.md");
		expect(coursePlan).toContain("10 alkalmas");
		expect(coursePlan).toContain("LearnCProgramming.pdf");
		expect(coursePlan).toContain("C++Programming.pdf` 1. fejezet");
		expect(coursePlan).toContain("Elméleti anyag nélkül nem indulhat új lecke");

		const firstLessonTheory = read("locales/hu/lessons/00-algorithmic-thinking/theory.md");
		expect(firstLessonTheory).toContain("Algoritmikus gondolkodás");
		expect(firstLessonTheory).toContain("C++Programming.pdf");
		expect(firstLessonTheory).toContain("Modern C++ előretekintő");
		expect(firstLessonTheory).toContain("std::cin");
		expect(firstLessonTheory).not.toMatch(hanCharacter);

		for (const exercisePath of [
			"exercises/00-basics/01-hello-and-variables.md",
			"exercises/01-control-flow/01-temperature-check.md",
			"exercises/02-functions/01-number-statistics.md",
			"exercises/00-algorithmic-thinking/01-snack-automata.md",
			"exercises/01-variables-datatypes/01-kor-terulet-konverzio.md",
			"exercises/02-control-flow/01-eredmeny-ertekelo.md",
			"exercises/03-arrays-pointers/01-meresi-adatok.md",
			"exercises/04-strings/01-szoveg-statisztika.md",
			"exercises/05-functions/01-teglatest-szamolo.md",
			"exercises/06-structs/01-tanuloi-nyilvantartas.md",
			"exercises/07-oop/01-homerseklet-meres.md",
			"exercises/08-file-io/01-meresi-naplo.md",
			"exercises/09-main-argv-project/01-kiadas-osszesito.md",
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
		expect(Object.keys(progress.modules)).toHaveLength(10);
		expect(progress.modules).toHaveProperty("09-main-argv-project");

		const reportTemplate = read("locales/hu/templates/teacher-report.md");
		expect(reportTemplate).toContain("## Teljesített modulok");
		expect(reportTemplate).toContain("## Következő javasolt lépés");
		expect(reportTemplate).toContain("A tanuló által jóváhagyott összesítés");
	});
});
