/**
 * L2 Wiki Summarizer — uses the agent's configured model via PI SDK
 * to generate structured wiki summaries from extracted content.
 */

import { logger } from "../../logger.js";
import { complete } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

const SUMMARIZE_PROMPT = `Te vagy a tudásbázis-kezelő asszisztens. Készíts strukturált Wiki-kivonatoldalt az alábbi anyaghoz.

Anyag címe: {title}

Anyag tartalma:
---
{content}
---

Szigorúan az alábbi formátumban adj ki tiszta Markdown-t (ne használj kódblokk-jelölőt):

## Összegzés

Foglald össze az anyag lényegét 1-3 tömör bekezdésben.

## Kulcsfogalmak

Sorold fel az anyag kulcsfogalmait, technológiáit, személyeit vagy projektjeit; mindegyiket [[kétirányú hivatkozás]] formátumban jelöld:
- [[fogalomnév]]: egymondatos magyarázat

## Fontos tudáspontok

Felsorolásos listában adj meg 3-8 legfontosabb tudáspontot vagy következtetést.`;

const MAX_CONTENT_LENGTH = 50000;

/**
 * Call the agent's configured LLM to generate a structured wiki summary.
 * Returns the generated markdown body, or null on failure.
 */
export async function summarizeContent(
	model: Model<any>,
	modelRegistry: ModelRegistry,
	title: string,
	content: string,
): Promise<string | null> {
	const truncated =
		content.length > MAX_CONTENT_LENGTH
			? content.slice(0, MAX_CONTENT_LENGTH) + "\n\n...(a tartalom csonkolva)"
			: content;

	const prompt = SUMMARIZE_PROMPT.replace("{title}", title).replace("{content}", truncated);

	try {
		const auth = await modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) {
			logger.error("[L2 summarizer] Failed to resolve API key");
			return null;
		}

		const response = await complete(
			model,
			{
				messages: [
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: prompt }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				maxTokens: 4096,
			},
		);

		if (response.stopReason === "error") {
			logger.error({ errorMessage: response.errorMessage }, `[L2 summarizer] LLM error: ${response.errorMessage ?? "unknown"}`);
			return null;
		}

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();

		return text || null;
	} catch (err) {
		logger.warn({ err }, "[L2 summarizer] Failed");
		return null;
	}
}
