import { EventEmitter } from "./event-emitter.js";
import { closeTerminalSession, createTerminalSession, terminalWsUrl } from "../api/terminal.js";
import type { ClientTerminalEvent, ServerTerminalEvent } from "../types/terminal.js";

interface TerminalStoreEvents {
	change: void;
	/** Raw output chunk forwarded to whoever owns the xterm instance. */
	output: string;
}

export type TerminalStatus =
	| "idle"
	| "connecting"
	| "connected"
	| "running"
	| "disconnected"
	| "error";

export class TerminalStoreImpl extends EventEmitter<TerminalStoreEvents> {
	terminalId: string | null = null;
	innoSessionId: string | null = null;
	workspaceId: string | null = null;
	cwd: string | null = null;
	status: TerminalStatus = "idle";
	error = "";
	isOpen = false;
	activeRunId: string | null = null;
	lastCommand: string | null = null;

	private ws: WebSocket | null = null;
	private pendingRun: {
		event: Extract<ClientTerminalEvent, { type: "run" }>;
		target?: { sessionId: string; workspaceId?: string };
	} | null = null;
	private connectionGeneration = 0;

	setOpen(open: boolean): void {
		if (this.isOpen === open) return;
		this.isOpen = open;
		this.emit("change", undefined);
	}

	async connect(innoSessionId: string, workspaceId?: string, cols = 100, rows = 24): Promise<void> {
		// If already connected to same session, no-op.
		if (this.innoSessionId === innoSessionId && this.status === "connected" && this.ws) return;
		const generation = ++this.connectionGeneration;
		// A Run gomb a drawer/TerminalView mountja előtt hívhatja a store-t. A
		// connect kezdeti takarítása ezért nem dobhatja el a queued parancsot.
		await this.cleanupConnection(true);
		if (generation !== this.connectionGeneration) return;

		this.innoSessionId = innoSessionId;
		this.status = "connecting";
		this.error = "";
		this.emit("change", undefined);

		try {
			const info = await createTerminalSession({ sessionId: innoSessionId, workspaceId, cols, rows });
			if (generation !== this.connectionGeneration) {
				try { await closeTerminalSession(info.id); } catch { /* stale session cleanup */ }
				return;
			}
			this.terminalId = info.id;
			this.workspaceId = info.workspaceId;
			this.cwd = info.cwd;
		} catch (err) {
			if (generation !== this.connectionGeneration) return;
			this.status = "error";
			this.error = err instanceof Error ? err.message : "Failed to create terminal";
			this.emit("change", undefined);
			return;
		}

		const ws = new WebSocket(terminalWsUrl(this.terminalId!));
		this.ws = ws;
		// Watchdog: if the server's `ready` event doesn't arrive within 5s,
		// flip to error so the UI stops showing 'connecting…' forever. The
		// most common cause is a dev-mode proxy that isn't forwarding WS.
		const watchdog = setTimeout(() => {
			if (generation === this.connectionGeneration && this.ws === ws && this.status === "connecting") {
				this.status = "error";
				this.error = "WebSocket connect timed out (check vite proxy `ws: true`?)";
				this.emit("change", undefined);
				try { ws.close(); } catch { /* ignore */ }
			}
		}, 5000);
		ws.onmessage = (ev) => {
			if (generation !== this.connectionGeneration || this.ws !== ws) return;
			let event: ServerTerminalEvent;
			try {
				event = JSON.parse(ev.data) as ServerTerminalEvent;
			} catch {
				return;
			}
			switch (event.type) {
				case "ready":
					clearTimeout(watchdog);
					this.status = "connected";
					if (this.pendingRun) {
						const pending = this.pendingRun;
						const targetMatches = !pending.target || (
							pending.target.sessionId === innoSessionId &&
							(pending.target.workspaceId === undefined || pending.target.workspaceId === this.workspaceId)
						);
						this.pendingRun = null;
						if (targetMatches) this.send(pending.event);
						else this.error = "Queued Run target changed before terminal connected";
					}
					this.emit("change", undefined);
					break;
				case "output":
					this.emit("output", event.data);
					break;
				case "run_started":
					this.activeRunId = event.runId;
					this.lastCommand = event.command;
					this.status = "running";
					this.emit("change", undefined);
					break;
				case "exit":
					this.activeRunId = null;
					this.status = "connected";
					this.emit("change", undefined);
					break;
				case "error":
					this.error = event.message;
					this.emit("change", undefined);
					break;
			}
		};
		ws.onopen = () => {
			// status flips to 'connected' on the server's 'ready' event
		};
		ws.onclose = () => {
			clearTimeout(watchdog);
			if (generation !== this.connectionGeneration || this.ws !== ws) return;
			if (this.status !== "error") this.status = "disconnected";
			this.ws = null;
			this.emit("change", undefined);
		};
		ws.onerror = () => {
			clearTimeout(watchdog);
			if (generation !== this.connectionGeneration || this.ws !== ws) return;
			this.status = "error";
			this.error = "WebSocket error";
			this.emit("change", undefined);
		};
	}

	send(event: ClientTerminalEvent): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		this.ws.send(JSON.stringify(event));
	}

	input(data: string): void {
		this.send({ type: "input", data });
	}

	resize(cols: number, rows: number): void {
		this.send({ type: "resize", cols, rows });
	}

	runCommand(
		command: string,
		sourceFile?: string,
		target?: { sessionId: string; workspaceId?: string },
	): boolean {
		if (!command.trim()) return false;
		if (this.status === "running" || this.pendingRun) {
			this.error = "A program már fut vagy indításra vár";
			this.emit("change", undefined);
			return false;
		}
		this.error = "";
		this.lastCommand = command;
		this.setOpen(true);
		const event: Extract<ClientTerminalEvent, { type: "run" }> = { type: "run", command, sourceFile };
		const targetMatches = !target || (
			target.sessionId === this.innoSessionId &&
			(target.workspaceId === undefined || target.workspaceId === this.workspaceId)
		);
		if (this.ws?.readyState === WebSocket.OPEN && this.status === "connected" && targetMatches) {
			this.send(event);
		} else {
			this.pendingRun = { event, target };
		}
		return true;
	}

	private async cleanupConnection(preservePendingRun: boolean): Promise<void> {
		const id = this.terminalId;
		const ws = this.ws;
		this.ws = null;
		this.terminalId = null;
		this.innoSessionId = null;
		this.workspaceId = null;
		this.cwd = null;
		this.activeRunId = null;
		if (!preservePendingRun) this.pendingRun = null;
		this.status = "idle";
		this.emit("change", undefined);
		if (ws) {
			try { ws.close(); } catch { /* ignore */ }
		}
		if (id) {
			try { await closeTerminalSession(id); } catch { /* server may be gone */ }
		}
	}

	async disconnect(preservePendingRun = false): Promise<void> {
		this.connectionGeneration++;
		await this.cleanupConnection(preservePendingRun);
	}
}

export const terminalStore = new TerminalStoreImpl();
