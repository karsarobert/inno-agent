import { describe, expect, it } from "vitest";
import { DEFAULT_CONTENT_HUB, normalizeContentHubConfig } from "./config.js";
import { createContentSource } from "./content-source/index.js";

describe("normalizeContentHubConfig", () => {
	it("defaults to the built-in public hub when the hub is not configured", () => {
		expect(normalizeContentHubConfig(undefined)).toEqual(DEFAULT_CONTENT_HUB);
	});

	it("keeps github config as-is", () => {
		const hub = normalizeContentHubConfig({
			type: "github",
			owner: "someone",
			repo: "some-hub",
			ref: "main",
			skillsPath: "skill-library",
			presetsPath: "workspace-templates",
		});
		expect(hub.type).toBe("github");
		expect(hub.owner).toBe("someone");
		expect(hub.repo).toBe("some-hub");
	});

	it("normalizes an explicit \"none\" type into a fully empty hub config", () => {
		const hub = normalizeContentHubConfig({ type: "none", owner: "ignored", repo: "ignored" });
		expect(hub.type).toBe("none");
		expect(hub.owner).toBe("");
		expect(hub.repo).toBe("");
		expect(hub.baseUrl).toBe("");
		expect(hub.token).toBe("");
	});

	it("treats unknown types as the default github hub", () => {
		expect(normalizeContentHubConfig({ type: "something-else" as never }).type).toBe("github");
	});
});

describe("createContentSource with type none", () => {
	it("returns a source whose categories are empty and downloads fail", async () => {
		const source = createContentSource(normalizeContentHubConfig({ type: "none" }));
		expect(await source.listItems("skills")).toEqual([]);
		expect(await source.listItems("presets")).toEqual([]);
		expect(await source.readItemTextFile("presets", "any", "preset.json")).toBeNull();
		await expect(source.downloadItem("presets", "any", "/tmp")).rejects.toThrow(/disabled/);
	});
});
