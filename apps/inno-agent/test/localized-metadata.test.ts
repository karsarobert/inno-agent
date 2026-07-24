import { describe, expect, it } from "vitest";
import { localizeContentMetadata } from "../src/content-source/localized-metadata.js";

describe("localized content metadata", () => {
	const canonical = {
		id: "ielts-prep",
		name: "雅思备考",
		description: "学术英语备考工作区。",
		category: "教学",
		icon: "graduation-cap",
	};

	it("uses the requested Hungarian display metadata without changing identity fields", () => {
		const localized = localizeContentMetadata(canonical, {
			schemaVersion: 1,
			locales: {
				hu: { name: "IELTS-felkészítő", description: "Akadémiai angol felkészítő munkatér.", category: "oktatás" },
			},
		}, "hu");

		expect(localized).toEqual({
			metadata: {
				id: "ielts-prep",
				name: "IELTS-felkészítő",
				description: "Akadémiai angol felkészítő munkatér.",
				category: "oktatás",
				icon: "graduation-cap",
			},
			locale: "hu",
			fallback: false,
		});
	});

	it("falls back to English localized metadata before the canonical source", () => {
		const localized = localizeContentMetadata(canonical, {
			schemaVersion: 1,
			locales: {
				en: { name: "IELTS Preparation", description: "Academic English preparation workspace." },
			},
		}, "hu");
		expect(localized.metadata.name).toBe("IELTS Preparation");
		expect(localized.locale).toBe("en");
		expect(localized.fallback).toBe(true);
	});

	it("keeps canonical metadata when the localization document is absent or invalid", () => {
		const localized = localizeContentMetadata(canonical, null, "hu");
		expect(localized.metadata).toEqual(canonical);
		expect(localized.locale).toBeNull();
		expect(localized.fallback).toBe(true);
	});
});
