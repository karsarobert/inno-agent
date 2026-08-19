/**
 * Web search tool — wraps the Tavily Search API (@tavily/core) as the agent's
 * default internet search capability. Reads the API key live from configHolder
 * (`config.tavily.apiKey`) so settings changes take effect without a restart.
 * Unconfigured → the tool returns a "not configured" hint.
 */

import { tavily, type TavilySearchResponse } from "@tavily/core";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ConfigHolder } from "./inno-extension.js";
import { logger } from "../logger.js";

/** Upper bound for a single search request (seconds, Tavily API timeout). */
const REQUEST_TIMEOUT_S = 60;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 10;

function resolveApiKey(holder: ConfigHolder): string | undefined {
	const key = holder.current.tavily?.apiKey?.trim();
	return key || undefined;
}

/** Format a Tavily search response into agent-readable markdown text. */
function formatResults(resp: TavilySearchResponse): string {
	const parts: string[] = [];
	if (resp.answer?.trim()) {
		parts.push(`## Összegzés\n\n${resp.answer.trim()}`);
	}
	const results = resp.results ?? [];
	if (results.length > 0) {
		const lines = results.map((r, i) => {
			const published = r.publishedDate ? ` (${r.publishedDate})` : "";
			return `${i + 1}. [${r.title}](${r.url})${published}\n   ${r.content}`;
		});
		parts.push(`## Keresési eredmények\n\n${lines.join("\n\n")}`);
	}
	return parts.join("\n\n") || "Nem található releváns eredmény.";
}

export function createTavilyTools(configHolder: ConfigHolder): ToolDefinition[] {
	const tool = defineTool({
		name: "web_search",
		label: "Internetes keresés (Tavily)",
		description:
			"A Tavily keresőmotorral friss információkat keres az interneten; visszaadja az eredmények címét, URL-jét, tartalmi kivonatát és opcionálisan az összesített választ." +
			"Akkor használd, ha a felhasználó kérdése aktuális eseményekre, friss hírekre, a tudáshatáridőn túli tényekre vonatkozik, vagy kifejezetten internetes keresést kér." +
			"A query-t lehetőleg a felhasználó nyelvén fogalmazd meg; bonyolult vagy időérzékeny lekérdezéseknél a searchDepth advanced értéket is kaphat.",
		parameters: Type.Object({
			query: Type.String({ description: "Keresőkifejezés" }),
			searchDepth: Type.Optional(
				Type.Union([Type.Literal("basic"), Type.Literal("advanced")], {
					description: "Keresési mélység: basic gyors (alapértelmezett), advanced alaposabb, de lassabb és drágább",
				}),
			),
			maxResults: Type.Optional(
				Type.Number({ description: `Visszaadott találatok száma (1-${MAX_RESULTS_LIMIT}, alapértelmezés ${DEFAULT_MAX_RESULTS})` }),
			),
			topic: Type.Optional(
				Type.Union([Type.Literal("general"), Type.Literal("news"), Type.Literal("finance")], {
					description: "Keresési téma: general (alapértelmezett) / news / finance",
				}),
			),
			includeAnswer: Type.Optional(
				Type.Boolean({ description: "Visszaadja-e a Tavily összesített válaszát (alapértelmezés szerint true)" }),
			),
		}),
		async execute(_toolCallId, params) {
			const typed = params as {
				query: string;
				searchDepth?: "basic" | "advanced";
				maxResults?: number;
				topic?: "general" | "news" | "finance";
				includeAnswer?: boolean;
			};
			const query = String(typed.query ?? "").trim();
			if (!query) {
				return {
					content: [{ type: "text" as const, text: "Adj meg egy query értéket (keresőkifejezést)." }],
					details: { error: "missing_query" } as Record<string, unknown>,
				};
			}

			const apiKey = resolveApiKey(configHolder);
			if (!apiKey) {
				return {
					content: [{
						type: "text" as const,
						text: "A Tavily API-kulcs nincs beállítva. Töltsd ki az API-kulcsot a Beállítások „Internetes keresés (Tavily)” kártyáján, majd próbáld újra.",
					}],
					details: { error: "tavily_not_configured" } as Record<string, unknown>,
				};
			}

			const maxResults = Math.min(
				Math.max(Math.floor(typed.maxResults ?? DEFAULT_MAX_RESULTS), 1),
				MAX_RESULTS_LIMIT,
			);

			try {
				const client = tavily({ apiKey });
				const resp = await client.search(query, {
					searchDepth: typed.searchDepth ?? "basic",
					topic: typed.topic ?? "general",
					maxResults,
					includeAnswer: typed.includeAnswer ?? true,
					timeout: REQUEST_TIMEOUT_S,
				});

				return {
					content: [{ type: "text" as const, text: formatResults(resp) }],
					details: {
						query: resp.query,
						responseTime: resp.responseTime,
						resultCount: resp.results?.length ?? 0,
						results: (resp.results ?? []).map((r) => ({
							title: r.title,
							url: r.url,
							score: r.score,
						})),
					} as Record<string, unknown>,
				};
			} catch (err) {
				logger.warn({ err, query }, "web_search: tavily search failed");
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Az internetes keresés sikertelen: ${msg}` }],
					details: { error: "search_failed", query, message: msg } as Record<string, unknown>,
				};
			}
		},
	});

	return [tool];
}
