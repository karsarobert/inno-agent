/**
 * Default terminal command for a workspace file.
 *
 * Ported from the pre-v0.6.x line, where it lived in web/src/utils/run-command.ts:
 * compiled languages build into a hidden `.inno-cpp-<stem>` executable next to the
 * workspace and run it in the same command, so a failing build never runs a stale
 * binary (the `&&` chain stops on a compile error).
 */

function quoteForShell(path: string): string {
	return /[\s'"]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

function cppExecutablePath(relPath: string): string {
	const stem =
		relPath
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
