import { describe, expect, it } from "vitest";
import { DEFAULT_UI_LOCALE, currentLocale } from "../web/src/i18n/index.js";
import { DEFAULT_CONTENT_LOCALE, getContentLocale } from "../web/src/i18n/content-locale.js";

describe("default locale", () => {
	it("starts new sessions in Hungarian for both UI and content", () => {
		expect(DEFAULT_UI_LOCALE).toBe("hu");
		expect(DEFAULT_CONTENT_LOCALE).toBe("hu");
		expect(currentLocale()).toBe("hu");
		expect(getContentLocale()).toBe("hu");
	});
});
