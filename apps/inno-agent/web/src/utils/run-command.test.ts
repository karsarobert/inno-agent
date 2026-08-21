import { describe, expect, it } from "vitest";
import { defaultRunCommand, shouldShowRunButton, shouldShowTerminalDrawer } from "./run-command.js";

describe("defaultRunCommand", () => {
	it("builds and runs C++ sources with C++20 and warnings enabled", () => {
		expect(defaultRunCommand("submissions/01-uzsonnaautomata/main.cpp")).toBe(
			"g++ -std=c++20 -Wall -Wextra -pedantic submissions/01-uzsonnaautomata/main.cpp -o .inno-cpp-submissions-01-uzsonnaautomata-main && ./.inno-cpp-submissions-01-uzsonnaautomata-main",
		);
	});

	it("builds and runs C sources with C17 and warnings enabled", () => {
		expect(defaultRunCommand("submissions/01-hello/main.c")).toBe(
			"gcc -std=c17 -Wall -Wextra -Wpedantic submissions/01-hello/main.c -o .inno-cpp-submissions-01-hello-main && ./.inno-cpp-submissions-01-hello-main",
		);
	});

	it("builds and runs standalone C sources with the program fallback stem", () => {
		expect(defaultRunCommand("main.c")).toBe(
			"gcc -std=c17 -Wall -Wextra -Wpedantic main.c -o .inno-cpp-main && ./.inno-cpp-main",
		);
	});

	it("handles uppercase C extensions case-insensitively", () => {
		expect(defaultRunCommand("PROG.C")).toBe(
			"gcc -std=c17 -Wall -Wextra -Wpedantic PROG.C -o .inno-cpp-PROG && ./.inno-cpp-PROG",
		);
	});

	it("quotes C source paths containing spaces", () => {
		expect(defaultRunCommand("submissions/első feladat/main.c")).toContain(
			'"submissions/első feladat/main.c"',
		);
	});

	it("keeps unsupported files non-runnable", () => {
		expect(defaultRunCommand("kurzus-terv.md")).toBeNull();
	});
});

describe("shouldShowRunButton", () => {
	it("shows Practice Lab Run for C++ files in Simple Mode", () => {
		expect(shouldShowRunButton("starter/src/main.cpp", true)).toBe(true);
	});

	it("keeps unsupported files hidden in Simple Mode", () => {
		expect(shouldShowRunButton("kurzus-terv.md", true)).toBe(false);
	});

	it("keeps the Practice Lab terminal available in Simple Mode", () => {
		expect(shouldShowTerminalDrawer(true)).toBe(true);
	});
});
