import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalSession } from "../api/terminal.js";
import type { TerminalSessionInfo } from "../types/terminal.js";

vi.mock("../api/terminal.js", () => ({
	createTerminalSession: vi.fn(async () => ({
		id: "term-1",
		workspaceId: "preset-cpp-learning-coach-hu",
		cwd: "/workspace",
	})),
	closeTerminalSession: vi.fn(async () => undefined),
	terminalWsUrl: vi.fn(() => "ws://test/terminal/term-1"),
}));

class FakeWebSocket {
	static OPEN = 1;
	readyState = 0;
	sent: string[] = [];
	onmessage: ((ev: { data: string }) => void) | null = null;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(_url: string) {
		instances.push(this);
	}

	send(data: string) {
		this.sent.push(data);
	}

	close() {
		this.readyState = 3;
	}

	serverEvent(event: Record<string, unknown>) {
		this.onmessage?.({ data: JSON.stringify(event) });
	}

	serverReady() {
		this.readyState = FakeWebSocket.OPEN;
		this.serverEvent({ type: "ready" });
	}
}

const instances: FakeWebSocket[] = [];
vi.stubGlobal("WebSocket", FakeWebSocket);

import { TerminalStoreImpl } from "./terminal-store.js";

describe("TerminalStore queued Run", () => {
	beforeEach(() => {
		instances.length = 0;
		vi.mocked(createTerminalSession).mockReset().mockImplementation(async (input) => ({
			id: `term-${input.sessionId}`,
			sessionId: input.sessionId,
			workspaceId: input.workspaceId ?? "default",
			cwd: "/workspace",
			status: "ready",
		}));
	});

	it("queues Run before WS connect and flushes it exactly once on ready", async () => {
		const store = new TerminalStoreImpl();
		const command = "g++ -std=c++20 main.cpp -o app && ./app";
		store.runCommand(command, "main.cpp", {
			sessionId: "session-1",
			workspaceId: "preset-cpp-learning-coach-hu",
		});

		await store.connect("session-1", "preset-cpp-learning-coach-hu");
		const ws = instances[0]!;
		expect(ws.sent).toEqual([]);

		ws.serverReady();
		expect(ws.sent.map((raw) => JSON.parse(raw))).toEqual([
			{ type: "run", command, sourceFile: "main.cpp" },
		]);

		// Ismételt ready nem futtathatja másodszor ugyanazt a parancsot.
		ws.serverReady();
		expect(ws.sent).toHaveLength(1);
	});

	it("rejects a second Run while the previous program is running", async () => {
		const store = new TerminalStoreImpl();
		store.runCommand("first", "first.cpp", { sessionId: "session-1", workspaceId: "ws-1" });
		await store.connect("session-1", "ws-1");
		const ws = instances[0]!;
		ws.serverReady();
		ws.serverEvent({ type: "run_started", runId: "run-1", command: "first" });

		expect(store.runCommand("second", "second.cpp", { sessionId: "session-1", workspaceId: "ws-1" })).toBe(false);
		expect(ws.sent).toHaveLength(1);
		expect(store.error).toMatch(/already running|már fut/i);
	});

	it("ignores a stale connect response after a fast session switch", async () => {
		const pending = new Map<string, (value: TerminalSessionInfo) => void>();
		vi.mocked(createTerminalSession).mockImplementation((input) => new Promise((resolve) => {
			pending.set(input.sessionId, resolve);
		}));
		const store = new TerminalStoreImpl();
		const oldConnect = store.connect("old-session", "old-workspace");
		await vi.waitFor(() => expect(pending.has("old-session")).toBe(true));
		const newConnect = store.connect("new-session", "new-workspace");
		await vi.waitFor(() => expect(pending.size).toBe(2));

		pending.get("new-session")!({ id: "term-new", sessionId: "new-session", workspaceId: "new-workspace", cwd: "/new", status: "ready" });
		await newConnect;
		pending.get("old-session")!({ id: "term-old", sessionId: "old-session", workspaceId: "old-workspace", cwd: "/old", status: "ready" });
		await oldConnect;

		expect(store.innoSessionId).toBe("new-session");
		expect(store.workspaceId).toBe("new-workspace");
		expect(store.terminalId).toBe("term-new");
		expect(instances).toHaveLength(1);
	});
});
