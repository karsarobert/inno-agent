import { describe, expect, it } from "vitest";
import en from "../web/src/i18n/locales/en.json";
import hu from "../web/src/i18n/locales/hu.json";
import zhCN from "../web/src/i18n/locales/zh-CN.json";

function leafPaths(value: unknown, path = ""): string[] {
	if (typeof value === "string") return [path];
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	return Object.entries(value).flatMap(([key, child]) => leafPaths(child, path ? `${path}.${key}` : key));
}

describe("Hungarian UI catalog", () => {
	it("has the same translation key set as English and Chinese", () => {
		const expected = leafPaths(en).sort();
		expect(leafPaths(hu).sort()).toEqual(expected);
		expect(leafPaths(zhCN).sort()).toEqual(expected);
	});

	it("contains Hungarian labels for the language controls", () => {
		expect(hu.settings.language).toBe("Nyelv");
		expect(hu.settings.contentLanguage).toBe("Tartalom nyelve");
		expect(hu.settings.languageOptions.hu).toBe("Magyar");
	});

	it("keeps the Hungarian catalog free of Chinese fallback text", () => {
		const chinese = /[\u4e00-\u9fff]/;
		const offenders = leafPaths(hu)
			.map((path) => ({ path, value: path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], hu) as string }))
			.filter(({ value }) => chinese.test(value));
		expect(offenders.map((o) => o.path)).toEqual([]);
	});
});
