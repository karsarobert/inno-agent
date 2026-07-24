import { apiFetch } from "./client.js";
import type { PresetMeta } from "../types/presets.js";

/** Presets already materialized in the local cache (offline fallback). */
export async function listPresets(contentLocale = "en"): Promise<PresetMeta[]> {
	return apiFetch<PresetMeta[]>(`/api/presets?contentLocale=${encodeURIComponent(contentLocale)}`);
}

/** Live preset catalog from the remote content hub (Simple Mode cards). */
export async function listRemotePresets(forceRefresh = false, contentLocale = "en"): Promise<PresetMeta[]> {
	const params = new URLSearchParams({ contentLocale });
	if (forceRefresh) params.set("refresh", "1");
	return apiFetch<PresetMeta[]>(`/api/preset-library?${params.toString()}`);
}

