function quoteForShell(path: string): string {
	return /[\s'"]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

function cppExecutablePath(relPath: string): string {
	const stem = relPath
		.replace(/\.(?:cpp|cc|cxx|c)$/i, "")
		.replace(/[^a-zA-Z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "") || "program";
	return `.inno-cpp-${stem}`;
}

/** Return the command that the workspace terminal should run for a source file. */
export function defaultRunCommand(relPath: string): string | null {
	const lower = relPath.toLowerCase();
	const quoted = quoteForShell(relPath);
	if (lower.endsWith(".py")) return `python ${quoted}`;
	if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return `node ${quoted}`;
	if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return `npx tsx ${quoted}`;
	if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return `bash ${quoted}`;
	if (lower.endsWith(".c")) {
		const executable = cppExecutablePath(relPath);
		const quotedExecutable = quoteForShell(executable);
		return `gcc -std=c17 -Wall -Wextra -Wpedantic ${quoted} -o ${quotedExecutable} && ./${quotedExecutable}`;
	}
	if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx")) {
		const executable = cppExecutablePath(relPath);
		const quotedExecutable = quoteForShell(executable);
		return `g++ -std=c++20 -Wall -Wextra -pedantic ${quoted} -o ${quotedExecutable} && ./${quotedExecutable}`;
	}
	return null;
}

/**
 * A Run kontroll láthatósága kizárólag a fájl futtathatóságától függ.
 * A Simple Mode a tanulói felület, ezért nem rejtheti el a Practice Labot.
 */
export function shouldShowRunButton(filePath: string | null | undefined, _simpleMode: boolean): boolean {
	return Boolean(filePath && defaultRunCommand(filePath));
}

/** Practice Lab is a learner feature, so Simple Mode must not hide its drawer. */
export function shouldShowTerminalDrawer(_simpleMode: boolean): boolean {
	return true;
}
