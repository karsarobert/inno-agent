import { describe, expect, it } from "vitest";
import { normalizeContentLocale, resolveContentLocale } from "../src/content-source/content-locale.js";

describe("content locale selection", () => {
	it("accepts the three supported locale identifiers only", () => {
		expect(normalizeContentLocale("hu")).toBe("hu");
		expect(normalizeContentLocale("en")).toBe("en");
		expect(normalizeContentLocale("zh-CN")).toBe("zh-CN");
		expect(normalizeContentLocale("hu-HU")).toBeNull();
		expect(normalizeContentLocale("../../hu")).toBeNull();
	});

	it("prefers the requested Hungarian content when it is available", () => {
		expect(resolveContentLocale("hu", ["en", "hu", "zh-CN"])).toEqual({ locale: "hu", fallback: false });
	});

	it("falls back predictably without silently accepting an unsafe locale", () => {
		expect(resolveContentLocale("hu", ["en", "zh-CN"])).toEqual({ locale: "en", fallback: true });
		expect(resolveContentLocale("../../hu", ["zh-CN"])).toEqual({ locale: "zh-CN", fallback: true });
		expect(resolveContentLocale("hu", [])).toBeNull();
	});
});
