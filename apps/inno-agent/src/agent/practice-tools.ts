import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { WorkspaceRegistry } from "../workspace/workspace-registry.js";
import { logger } from "../logger.js";

interface PracticeToolDeps {
	registry: WorkspaceRegistry;
	getCurrentSessionId(): string;
}

const FileSchema = Type.Object({
	path: Type.String({ description: "Relative path inside the workspace, e.g. 'main.py' or 'data/sample.csv'." }),
	content: Type.String({ description: "Full UTF-8 file content." }),
});

const CreatePracticeLabSchema = Type.Object({
	title: Type.Optional(Type.String({ description: "Human-readable lab title." })),
	files: Type.Array(FileSchema, {
		description: "Files to write. Paths must stay inside the current workspace.",
		minItems: 1,
	}),
	mainFile: Type.Optional(Type.String({ description: "Which file the user should look at first." })),
	suggestedCommand: Type.Optional(Type.String({ description: "Shell command the user can click Run to execute, e.g. 'python main.py'." })),
});

export function createPracticeTools(deps: PracticeToolDeps): ToolDefinition[] {
	const createPracticeLab = defineTool({
		name: "create_practice_lab",
		label: "Create Practice Lab",
		description:
			"Hozz létre egy gyakorlófájl-készletet (kód, adat, leírás) az aktuális munkamenethez kötött munkaterületen. A visszaadott strukturált eredmény tartalmazza a mainFile-t és a suggestedCommand-ot; az előtér automatikusan megnyitja a mainFile-t, és megjeleníti a Run gombot. A kód csak akkor fut, ha a felhasználó a Run gombra kattint; ne futtass bash-t magad.",
		parameters: CreatePracticeLabSchema,
		async execute(_toolCallId, params) {
			const typed = params as {
				title?: string;
				files: Array<{ path: string; content: string }>;
				mainFile?: string;
				suggestedCommand?: string;
			};
			const sessionId = deps.getCurrentSessionId();
			const workspaceId = deps.registry.getSessionWorkspaceId(sessionId);
			const workspaceRoot = deps.registry.resolveWorkspaceDir(workspaceId);
			if (!workspaceRoot) {
				return {
					content: [{ type: "text" as const, text: `Workspace not found: ${workspaceId}` }],
					details: {
						ok: false as boolean,
						error: "workspace_not_found" as string | undefined,
						workspaceId,
						workspaceRoot: "" as string,
						files: [] as Array<{ path: string }>,
						mainFile: undefined as string | undefined,
						suggestedCommand: undefined as string | undefined,
						title: undefined as string | undefined,
					},
				};
			}

			const written: Array<{ path: string }> = [];
			const errors: string[] = [];

			for (const file of typed.files) {
				const rel = file.path.replace(/^\/+/, "");
				const abs = resolve(workspaceRoot, rel);
				const within = relative(resolve(workspaceRoot), abs);
				if (within.startsWith("..")) {
					errors.push(`Path escapes workspace: ${file.path}`);
					continue;
				}
				if (existsSync(abs)) {
					errors.push(`Refusing to overwrite existing workspace file: ${file.path}`);
					continue;
				}
				try {
					mkdirSync(dirname(abs), { recursive: true });
					writeFileSync(abs, file.content, "utf-8");
					written.push({ path: rel });
				} catch (err) {
					errors.push(`Failed to write ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}

			const mainFile = typed.mainFile && written.some((f) => f.path === typed.mainFile)
				? typed.mainFile
				: (written[0]?.path ?? undefined);

			const lines: string[] = [];
			if (typed.title) lines.push(`Lab: ${typed.title}`);
			lines.push(`Workspace: ${workspaceId}`);
			lines.push(`Files written (${written.length}):`);
			for (const f of written) lines.push(`  - ${f.path}`);
			if (mainFile) lines.push(`Main file: ${mainFile}`);
			if (typed.suggestedCommand) lines.push(`Suggested command: ${typed.suggestedCommand}`);
			if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					ok: (errors.length === 0) as boolean,
					error: (errors.length > 0 ? errors.join("; ") : undefined) as string | undefined,
					title: typed.title,
					workspaceId,
					workspaceRoot,
					files: written,
					mainFile,
					suggestedCommand: typed.suggestedCommand,
				},
			};
		},
	});

	return [createPracticeLab];
}
