import { describe, expect, it } from "vitest";
import { buildSessionTopicPrompt } from "../src/chat/session-topic.js";

describe("buildSessionTopicPrompt", () => {
	it("requests a title in the first user message's language without Chinese-only instructions", () => {
		const prompt = buildSessionTopicPrompt([
			{ role: "user", content: "Kezdjük el a C++ első leckéjét." },
			{ role: "assistant", content: "Rendben, nézzük az algoritmikus gondolkodást." },
		]);

		expect(prompt).toContain("same language as the user's first message");
		expect(prompt).toContain("Kezdjük el a C++ első leckéjét.");
		expect(prompt).not.toMatch(/中文|用户|助手/u);
	});
});
