import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ChannelRegistry, FileSendNotSupportedError } from "./channel.js";
import type { ChannelName } from "./types.js";
import type { WorkspaceRegistry } from "../workspace/workspace-registry.js";
import { logger } from "../logger.js";

export interface ChannelToolsDeps {
	channelRegistry: ChannelRegistry;
	/** Resolve workspace files for the active session (server mode). */
	workspaceRegistry?: WorkspaceRegistry;
	getCurrentSessionId?: () => string;
	/** Fallback workspace root (CLI / no registry). */
	workspaceDir: string;
	/**
	 * Tag the active session as having interacted with a channel. Called after a
	 * successful file send so the session picks up the channel badge in the UI.
	 */
	recordChannelInteraction?: (channel: ChannelName) => void;
}

/**
 * Resolve the active session's workspace directory. Falls back to the runtime
 * workspace root when no registry/session mapping is available (CLI mode).
 */
function resolveWorkspaceDir(deps: ChannelToolsDeps): string {
	if (deps.workspaceRegistry && deps.getCurrentSessionId) {
		try {
			const sessionId = deps.getCurrentSessionId();
			if (sessionId) {
				const workspaceId = deps.workspaceRegistry.getSessionWorkspaceId(sessionId);
				const dir = deps.workspaceRegistry.resolveWorkspaceDir(workspaceId);
				if (dir) return dir;
			}
		} catch (err) {
			logger.warn({ err }, "failed to resolve workspace dir, falling back to root");
			// fall through to runtime workspace root
		}
	}
	return deps.workspaceDir;
}

/**
 * Safely resolve a user-supplied path against the workspace root, refusing any
 * path that escapes the workspace via `..` or absolute traversal.
 */
function safeResolveInWorkspace(workspaceDir: string, userPath: string): string | null {
	const root = resolve(workspaceDir);
	const cleaned = isAbsolute(userPath) ? userPath : userPath.replace(/^\/+/, "");
	const resolved = resolve(root, cleaned);
	const rel = relative(root, resolved);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
	return resolved;
}

/**
 * Create channel-facing tools. Currently exposes `send_file_to_channel`, which
 * pushes a workspace file out to a chat channel (Feishu, etc.).
 */
export function createChannelTools(deps: ChannelToolsDeps): ToolDefinition[] {
	const sendFileTool = defineTool({
		name: "send_file_to_channel",
		label: "Fájl küldése csatornára",
		description:
			"Egy munkaterületi fájl elküldése csevegőcsatornára (pl. Feishu)." +
			"Akkor hívd, ha a felhasználó azt mondja: „küldd el nekem a xxx fájlt”, „küldd el Feishu-ra/WeChatre” vagy „amikor kész, küldd el nekem”." +
			"A filePath a munkaterülethez viszonyított elérési út. A channel opcionális; ha nincs megadva, az üzenet forráscsatornájának alapértelmezett célját használja." +
			"Megjegyzés: a WeChat (iLink) csatorna jelenleg nem támogatja a fájlküldést; ha a felhasználó nem konfigurált csatornát, a rendszer jelzi, hogy állítson be.",
		parameters: Type.Object({
			filePath: Type.String({ description: "A küldendő fájl elérési útja (a munkaterülethez viszonyítva)" }),
			channel: Type.Optional(
				StringEnum(["feishu", "wechat", "qq", "wecom"] as const, {
					description: "Célcsatorna (opcionális). Alapértelmezésben a regisztrált csatorna alapértelmezett célját használja.",
				}),
			),
			chatId: Type.Optional(
				Type.String({ description: "Cél chat_id (opcionális). Alapértelmezésben az adott csatorna alapértelmezett célját használja." }),
			),
			fileName: Type.Optional(
				Type.String({ description: "A küldéskor megjelenő fájlnév (opcionális); alapértelmezésben a fájl saját neve." }),
			),
		}),
		async execute(_toolCallId, params) {
			const registered = deps.channelRegistry.all();
			if (registered.length === 0) {
				return {
					content: [{
						type: "text" as const,
						text: "Nincs beállítva üzenetcsatorna, ezért a fájl nem küldhető el. Előbb engedélyezz és konfigurálj egy csatornát (pl. Feishu vagy WeChat) a Beállításokban, majd próbáld újra.",
					}],
					details: { error: "no_channels_configured" } as Record<string, unknown>,
				};
			}

			// Resolve the target channel: explicit param → unique registered channel.
			let channelName: ChannelName | undefined = params.channel as ChannelName | undefined;
			if (!channelName) {
				if (registered.length === 1) {
					channelName = registered[0].name as ChannelName;
				} else {
					const names = registered.map((c) => c.name).join("、");
					return {
						content: [{
							type: "text" as const,
							text: `Több csatornát engedélyeztél (${names}). Mondd meg, melyik csatornára küldjem, vagy add meg a channel paramétert a hívásnál.`,
						}],
						details: { error: "channel_ambiguous", available: registered.map((c) => c.name) } as Record<string, unknown>,
					};
				}
			}

			const channel = deps.channelRegistry.get(channelName);
			if (!channel) {
				return {
					content: [{
						type: "text" as const,
						text: `A(z) „${channelName}” csatorna még nincs engedélyezve vagy beállítva, ezért a fájl nem küldhető el. Előbb engedélyezd és állítsd be a csatornát a Beállításokban.`,
					}],
					details: { error: "channel_not_registered", channel: channelName } as Record<string, unknown>,
				};
			}

			if (!channel.sendFile) {
				return {
					content: [{
						type: "text" as const,
						text: `A(z) „${channelName}” csatorna jelenleg nem támogatja a fájlküldést.`,
					}],
					details: { error: "file_send_not_supported", channel: channelName } as Record<string, unknown>,
				};
			}

			// Resolve the push target.
			const chatId = params.chatId?.trim()
				|| deps.channelRegistry.getDefaultTarget(channelName)?.chatId;
			if (!chatId) {
				return {
					content: [{
						type: "text" as const,
						text: `Még nem tudom, melyik beszélgetésbe küldjem a fájlt a(z) „${channelName}” csatornán. Előbb küldj egy üzenetet erről a csatornáról (ez rögzíti az alapértelmezett célpontot), vagy add meg a chatId-t a hívásnál.`,
					}],
					details: { error: "no_target", channel: channelName } as Record<string, unknown>,
				};
			}

			// Resolve and validate the file path within the workspace.
			const workspaceDir = resolveWorkspaceDir(deps);
			const resolved = safeResolveInWorkspace(workspaceDir, params.filePath);
			if (!resolved) {
				return {
					content: [{
						type: "text" as const,
						text: `A fájl elérési útja érvénytelen vagy a munkaterületen kívülre mutat: ${params.filePath}`,
					}],
					details: { error: "invalid_path", filePath: params.filePath } as Record<string, unknown>,
				};
			}
			if (!existsSync(resolved) || !statSync(resolved).isFile()) {
				return {
					content: [{
						type: "text" as const,
						text: `A fájl nem található a munkaterületen: ${params.filePath}`,
					}],
					details: { error: "file_not_found", filePath: params.filePath } as Record<string, unknown>,
				};
			}

			try {
				await channel.sendFile({ channel: channelName, chatId }, resolved, params.fileName);
			} catch (err) {
				logger.warn({ err, channel: channelName, filePath: params.filePath }, "send_file_to_channel tool failed");
				if (err instanceof FileSendNotSupportedError) {
					return {
						content: [{ type: "text" as const, text: err.message }],
						details: { error: "file_send_not_supported", channel: channelName } as Record<string, unknown>,
					};
				}
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{
						type: "text" as const,
						text: `A fájl küldése a(z) „${channelName}” csatornára sikertelen: ${msg}`,
					}],
					details: { error: "send_failed", channel: channelName, message: msg } as Record<string, unknown>,
				};
			}

			// Tag the active session as having interacted with this channel so the
			// UI shows the channel badge (best-effort — never fail the send on this).
			try {
				deps.recordChannelInteraction?.(channelName);
			} catch (err) {
				logger.warn({ err }, "failed to tag session channel interaction");
				// ignore tagging failures
			}

			return {
				content: [{
					type: "text" as const,
					text: `A fájl elküldve: ${params.fileName ?? params.filePath} → „${channelName}”.`,
				}],
				details: { channel: channelName, chatId, filePath: params.filePath } as Record<string, unknown>,
			};
		},
	});

	return [sendFileTool];
}
