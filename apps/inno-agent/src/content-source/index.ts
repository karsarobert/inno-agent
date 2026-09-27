import type { InnoContentHubConfig } from "../config.js";
import { GitHubContentSource } from "./github-source.js";
import { BundleServiceSource } from "./bundle-source.js";
import type { ContentCategory, RemoteContentSource, RemoteItem } from "./types.js";

export * from "./types.js";
export { GitHubContentSource } from "./github-source.js";
export { BundleServiceSource } from "./bundle-source.js";

/**
 * Content source for a disabled hub (`type: "none"`). Every category is empty
 * and nothing can be downloaded, so a clean installation ships with no skill
 * library and no preset cards.
 */
class NoneContentSource implements RemoteContentSource {
	async listItems(_category: ContentCategory, _opts?: { forceRefresh?: boolean }): Promise<RemoteItem[]> {
		return [];
	}

	async readItemTextFile(_category: ContentCategory, _name: string, _relPath: string): Promise<string | null> {
		return null;
	}

	async downloadItem(_category: ContentCategory, _name: string, _targetDir: string): Promise<void> {
		throw new Error("Content Hub is disabled (type: none)");
	}

	invalidate(): void {
		// nothing cached
	}
}

/**
 * Build the content source for the configured hub. Returns a GitHub-backed
 * source by default; a "bundle" type yields the self-hosted service client;
 * "none" yields an empty source (hub disabled).
 *
 * The returned instance owns its own short-lived cache, so the server should
 * create it once and reuse it (recreating it on config change to pick up new
 * owner/repo/token), then call `invalidate()` when settings are saved.
 */
export function createContentSource(hub: InnoContentHubConfig): RemoteContentSource {
	if (hub.type === "bundle") {
		return new BundleServiceSource(hub);
	}
	if (hub.type === "none") {
		return new NoneContentSource();
	}
	return new GitHubContentSource(hub);
}
