import { describe, expect, it } from "vitest";
import { formatSessionTime } from "./session-time.js";

describe("formatSessionTime", () => {
	it("formats an older session in the selected Hungarian locale", () => {
		const formatted = formatSessionTime(
			"2026-07-24T13:41:00.000Z",
			"hu",
			new Date("2026-07-29T12:00:00.000Z"),
		);

		expect(formatted).toMatch(/24/);
		expect(formatted).not.toMatch(/[\u4e00-\u9fff]/u);
	});
});
