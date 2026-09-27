import type { IncomingMessage as HttpReq, ServerResponse } from "node:http";
import { logger } from "../../logger.js";
import { listPresets } from "../../presets/preset-store.js";
import type { PresetMeta } from "../../presets/preset-store.js";
import type { RuntimePaths } from "../../runtime.js";
import { json } from "../http-helpers.js";

export interface PresetsRouteContext {
	paths: RuntimePaths;
	listPresetLibrary: (forceRefresh?: boolean) => Promise<PresetMeta[]>;
	/** True when contentHub type is "none": no preset cards at all, not even the bundled ones. */
	isContentHubDisabled: () => boolean;
}

/**
 * /api/presets and /api/preset-library route domain (ready-to-use workspace
 * templates). Returns true when the request was handled. Extracted verbatim
 * from server.ts during the P2 route split — behavior unchanged.
 */
export async function handlePresetsRoutes(
	_req: HttpReq,
	res: ServerResponse,
	method: string,
	url: string,
	ctx: PresetsRouteContext,
): Promise<boolean> {
	const { paths, listPresetLibrary, isContentHubDisabled } = ctx;

	// --- Presets API (ready-to-use workspace templates) ---
	// Local cache listing (offline fallback / already-downloaded presets).
	if (method === "GET" && url === "/api/presets") {
		// With the hub disabled (type "none") there are no preset cards at all —
		// not even the bundled fallback presets (ppt-creation, lesson-plan,
		// scenario-explain), which are still shipped with the app.
		if (isContentHubDisabled()) {
			json(res, 200, []);
			return true;
		}
		json(res, 200, listPresets(paths));
		return true;
	}

	// Live catalog from the remote content hub (Simple Mode preset cards).
	// The initial load falls back to bundled presets so the shipped templates
	// always appear; an explicit refresh surfaces errors to the client so it can
	// keep the previous list and explain what happened.
	if (method === "GET" && url.split("?")[0] === "/api/preset-library") {
		// Disabled hub (type "none") must stay card-free: neither the remote
		// catalog nor the bundled fallback presets are served.
		if (isContentHubDisabled()) {
			json(res, 200, []);
			return true;
		}
		const forceRefresh = new URL(url, "http://localhost").searchParams.get("refresh") === "1";
		try {
			// listPresetLibrary already merges bundled presets with the
			// authoritative remote snapshot. The local cache remains available
			// through /api/presets for offline fallback.
			json(res, 200, await listPresetLibrary(forceRefresh));
		} catch (err) {
			logger.warn({ err }, "failed to list preset library; falling back to bundled presets");
			if (forceRefresh) {
				json(res, 502, { error: err instanceof Error ? err.message : "Failed to refresh preset library" });
			} else {
				json(res, 200, listPresets(paths));
			}
		}
		return true;
	}

	return false;
}
