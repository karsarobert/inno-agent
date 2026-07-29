import { describe, expect, it } from "vitest";
import { defaultRunCommand } from "./run-command.js";

describe("defaultRunCommand", () => {
	it("builds and runs C++ sources with C++20 and warnings enabled", () => {
		expect(defaultRunCommand("submissions/01-uzsonnaautomata/main.cpp")).toBe(
			"g++ -std=c++20 -Wall -Wextra -pedantic submissions/01-uzsonnaautomata/main.cpp -o .inno-cpp-submissions-01-uzsonnaautomata-main && ./.inno-cpp-submissions-01-uzsonnaautomata-main",
		);
	});

	it("quotes C++ source paths containing spaces", () => {
		expect(defaultRunCommand("submissions/első feladat/main.cpp")).toContain(
		'"submissions/első feladat/main.cpp"',
	);
	});

	it("keeps unsupported files non-runnable", () => {
		expect(defaultRunCommand("kurzus-terv.md")).toBeNull();
	});
});
