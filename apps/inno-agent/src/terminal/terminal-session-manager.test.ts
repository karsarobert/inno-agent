import { describe, expect, it } from "vitest";
import { assertTerminalPolicy, TerminalSessionManager, type TerminalSession } from "./terminal-session-manager.js";

function activeSession(tag = "__INNO_RUN_DONE_run_test123"): TerminalSession {
	return {
		id: "terminal-1",
		sessionId: "session-1",
		workspaceId: "workspace-1",
		cwd: "/tmp/workspace",
		pty: {} as TerminalSession["pty"],
		createdAt: 0,
		activeRun: {} as NonNullable<TerminalSession["activeRun"]>,
		sentinelBuffer: "",
		sentinelTag: tag,
		sentinelDone: false,
	};
}

describe("terminal server policy", () => {
	it("rejects student terminals when the server was not started with sandbox", () => {
		expect(() => assertTerminalPolicy({ userRole: "student", sandbox: false })).toThrow(/sandbox/i);
	});

	it("allows student terminals only with sandbox and keeps teacher direct mode compatible", () => {
		expect(() => assertTerminalPolicy({ userRole: "student", sandbox: true })).not.toThrow();
		expect(() => assertTerminalPolicy({ userRole: "teacher", sandbox: false })).not.toThrow();
	});
});

describe("TerminalSessionManager.processOutput", () => {
	const manager = new TerminalSessionManager({} as never, {} as never);

	it("forwards short interactive output before the run-completion sentinel arrives", () => {
		const session = activeSession();

		const processed = manager.processOutput(session, "Add meg az uzsonna árát: ");

		expect(processed.cleaned).toBe("Add meg az uzsonna árát: ");
		expect(processed.finishedRun).toBeUndefined();
		expect(session.sentinelBuffer).toBe("");
	});

	it("keeps only a split sentinel prefix while forwarding preceding program output", () => {
		const session = activeSession();

		const first = manager.processOutput(session, "Visszajáró: 100 Ft\n__INNO_RUN_DONE_run_te");
		expect(first.cleaned).toBe("Visszajáró: 100 Ft\n");
		expect(session.sentinelBuffer).toBe("__INNO_RUN_DONE_run_te");

		const second = manager.processOutput(session, "st123 0\n");
		expect(second.cleaned).toBe("");
		expect(second.finishedRun).toEqual({ exitCode: 0 });
	});
});
