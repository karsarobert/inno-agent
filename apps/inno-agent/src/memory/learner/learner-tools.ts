import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadProfile } from "./profile-store.js";
import { recordEventAndUpdateProfile } from "./profile-store.js";
import { buildContextPack } from "./context-pack.js";
import { patchProfile, updateProfile } from "./profile-updater.js";
import { createLearningEvent } from "./types.js";
import { logger } from "../../logger.js";

// ============================================================================
// TypeBox Schemas for complex types
// ============================================================================

const LearningGoalSchema = Type.Object({
	goal_id: Type.String({ description: "Unique goal identifier" }),
	title: Type.String({ description: "Goal title" }),
	type: StringEnum(["skill", "concept", "project", "exam", "habit"] as const),
	priority: Type.Number({ description: "Priority 0-1, higher is more important", minimum: 0, maximum: 1 }),
	status: StringEnum(["active", "paused", "completed", "archived"] as const),
	success_criteria: Type.Array(Type.String(), { description: "Measurable success criteria" }),
	source: StringEnum(["user_declared", "agent_inferred", "imported"] as const),
	updated_at: Type.String({ description: "ISO 8601 timestamp" }),
});

const KnowledgeStateSchema = Type.Object({
	concept_id: Type.String({ description: "Unique concept identifier, e.g. python.list_comprehension" }),
	concept_name: Type.String({ description: "Human-readable concept name" }),
	domain: Type.String({ description: "Knowledge domain, e.g. programming.python" }),
	mastery: Type.Number({ description: "Mastery level 0-1", minimum: 0, maximum: 1 }),
	confidence: Type.Number({ description: "Confidence in mastery estimate 0-1", minimum: 0, maximum: 1 }),
	stability: Type.Number({ description: "Knowledge stability 0-1", minimum: 0, maximum: 1 }),
	last_practiced_at: Type.Optional(Type.String({ description: "ISO 8601 timestamp" })),
	review_due_at: Type.Optional(Type.String({ description: "ISO 8601 timestamp for next review" })),
	evidence_ids: Type.Array(Type.String(), { description: "IDs of supporting learning events" }),
	diagnosis: Type.String({ description: "Current diagnosis of learner state on this concept" }),
	next_actions: Type.Array(Type.String(), { description: "Recommended next learning actions" }),
});

const MisconceptionSchema = Type.Object({
	misconception_id: Type.String({ description: "Unique misconception identifier" }),
	concept_id: Type.String({ description: "Related concept ID" }),
	description: Type.String({ description: "Description of the misconception" }),
	status: StringEnum(["active", "repairing", "resolved", "stale"] as const),
	severity: Type.Number({ description: "Severity 0-1", minimum: 0, maximum: 1 }),
	confidence: Type.Number({ description: "Confidence in this diagnosis 0-1", minimum: 0, maximum: 1 }),
	first_seen_at: Type.String({ description: "ISO 8601 timestamp" }),
	last_seen_at: Type.String({ description: "ISO 8601 timestamp" }),
	evidence_ids: Type.Array(Type.String(), { description: "IDs of supporting learning events" }),
	repair_strategy: Type.String({ description: "Strategy to fix this misconception" }),
});

const PreferencesSchema = Type.Object({
	explanation_style: Type.Optional(Type.Array(Type.String(), { description: "e.g. example_first, code_first, theory_first" })),
	practice_style: Type.Optional(Type.Array(Type.String(), { description: "e.g. small_steps, immediate_feedback" })),
	feedback_tone: Type.Optional(Type.Array(Type.String(), { description: "e.g. direct, encouraging, socratic" })),
	avoid: Type.Optional(Type.Array(Type.String(), { description: "Things to avoid in teaching" })),
});

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create the L1 learner tools.
 * The dataDir and learnerId are captured in closure. When `isEnabled` is
 * provided and returns false, every tool short-circuits to a disabled notice
 * so the profile is neither read nor mutated.
 */
export function createLearnerTools(
	dataDir: string,
	learnerId: string,
	isEnabled?: () => boolean,
): ToolDefinition[] {
	const L1_DISABLED_TEXT = "Az L1 tanulói profil ki van kapcsolva a beállításokban; jelenleg sem olvasás, sem frissítés nem történik.";
	const disabledResult = () => ({
		content: [{ type: "text" as const, text: L1_DISABLED_TEXT }],
		details: { disabled: true } as Record<string, unknown>,
	});

	const getLearnerContextTool = defineTool({
		name: "get_learner_context",
		label: "Get Learner Context",
		description:
			"Az aktuális tanulói kontextuscsomag beolvasása: aktív célok, kapcsolódó fogalmak elsajátítottsága, aktív tévhitek és tanítási tippek. Akkor hívd, ha új beszélgetés kezdődik, vagy ha ismerni kell a tanuló állapotát.",
		parameters: Type.Object({}),
		async execute() {
			if (isEnabled && !isEnabled()) return disabledResult();
			const profile = loadProfile(dataDir);
			const pack = buildContextPack(profile);
			return {
				content: [{ type: "text" as const, text: JSON.stringify(pack, null, 2) }],
				details: {},
			};
		},
	});

	const recordLearningEventTool = defineTool({
		name: "record_learning_event",
		label: "Record Learning Event",
		description:
			"Strukturált tanulási esemény naplózása, és a határozott jelek automatikus beépítése az L1 tanulói profilba. Akkor hívd, ha a tanuló célt tűz ki/állít le/vált, gyakorlatot végez, magyarázatot fogad el, önértékelést ad, preferenciát fejez ki, visszajelzést kap, vagy mérföldkőhöz ér.",
		parameters: Type.Object({
			event_type: StringEnum([
				"goal_declared",
				"exercise_attempt",
				"concept_explained",
				"self_assessed",
				"preference_stated",
				"feedback_received",
				"milestone_reached",
			] as const, { description: "Type of learning event" }),
			context: Type.Object({
				goal_id: Type.Optional(Type.String({ description: "Related goal ID" })),
				concept_ids: Type.Optional(Type.Array(Type.String(), { description: "Related concept IDs" })),
				session_id: Type.Optional(Type.String({ description: "Current session ID" })),
			}),
				payload: Type.Record(Type.String(), Type.Unknown(), {
					description:
						"Eseményspecifikus adatok. Cél leállításához add meg a goal_description/action/reason értékeket, pl. { goal_description: 'nem tanulok többé Rustot', action: 'archived' }. Célváltáshoz add meg a previous_goal és a goal értékeket.",
				}),
			derived_signals: Type.Optional(
				Type.Object({
					mastery_delta: Type.Optional(Type.Number({ description: "Change in mastery estimate" })),
					misconception_candidates: Type.Optional(Type.Array(Type.String(), { description: "Observed learner misconceptions or error patterns, e.g. ['thinks Rust ownership means the variable is destroyed after borrow']" })),
					affect: Type.Optional(Type.String({ description: "Detected affect, e.g. frustrated, confident" })),
					preference_candidates: Type.Optional(Type.Array(Type.String(), { description: "Megfigyelt tanulói preferenciák, pl. ['prefers code-first explanations', 'elkerüli a hosszú elméleti magyarázatokat']" })),
				}),
			),
		}),
		async execute(_toolCallId, params) {
			try {
				if (isEnabled && !isEnabled()) return disabledResult();
				const event = createLearningEvent(
					learnerId,
					params.event_type,
					params.context,
					params.payload as Record<string, unknown>,
					params.derived_signals,
				);
				const profile = recordEventAndUpdateProfile(dataDir, event);
				return {
					content: [
						{
							type: "text" as const,
							text: `A tanulási esemény rögzítve és a profillal szinkronizálva: ${event.event_id} (${event.event_type}); aktuális profilverzió: ${profile.version}`,
						},
					],
					details: { event_id: event.event_id, profile_version: profile.version },
				};
			} catch (err) {
				logger.warn({ err, params }, "record_learning_event tool failed");
				throw err;
			}
		},
		});

	const patchLearnerProfileTool = defineTool({
		name: "patch_learner_profile",
		label: "Patch Learner Profile",
		description:
			"Költséghatékony, részleges L1 tanulói profil-frissítés. Egy tanulási interakció után egy fogalom elsajátítottságának/diagnózisának/ismétlési idejének módosítására, preferencia vagy profilkivonat hozzáfűzésére szolgál; nem igényel teljes tudásállapot-objektumot.",
		parameters: Type.Object({
			concept_id: Type.Optional(Type.String({ description: "Concept ID to create or patch, e.g. rust.ownership" })),
			concept_name: Type.Optional(Type.String({ description: "Human-readable concept name" })),
			domain: Type.Optional(Type.String({ description: "Knowledge domain, e.g. programming.rust" })),
			mastery_delta: Type.Optional(Type.Number({ description: "Small mastery adjustment, e.g. 0.03 or -0.02" })),
			mastery: Type.Optional(Type.Number({ description: "Absolute mastery 0-1", minimum: 0, maximum: 1 })),
			confidence: Type.Optional(Type.Number({ description: "Confidence 0-1", minimum: 0, maximum: 1 })),
			stability_delta: Type.Optional(Type.Number({ description: "Knowledge stability adjustment" })),
			diagnosis: Type.Optional(Type.String({ description: "Updated diagnosis for this concept" })),
			next_actions_append: Type.Optional(Type.Array(Type.String(), { description: "Next actions to append" })),
			evidence_ids_append: Type.Optional(Type.Array(Type.String(), { description: "Supporting event IDs to append" })),
			last_practiced_at: Type.Optional(Type.String({ description: "ISO 8601 timestamp" })),
			review_due_at: Type.Optional(Type.String({ description: "ISO 8601 timestamp" })),
			preferences_append: Type.Optional(PreferencesSchema),
			profile_summary_append: Type.Optional(Type.String({ description: "One concise sentence to append to profile summary" })),
		}),
		async execute(_toolCallId, params) {
			try {
				if (isEnabled && !isEnabled()) return disabledResult();
				const updated = patchProfile(dataDir, params);
				return {
					content: [
						{
							type: "text" as const,
							text: `A tanulói profil részlegesen frissítve: ${updated.version} verzió`,
						},
					],
					details: { version: updated.version },
				};
			} catch (err) {
				logger.warn({ err, params }, "patch_learner_profile tool failed");
				throw err;
			}
		},
	});

	const updateLearnerProfileTool = defineTool({
		name: "update_learner_profile",
		label: "Update Learner Profile",
		description:
			"A tanulói profil egyes mezőinek frissítése. Frissíthető a cél, a tudásállapot, a tévhitek, a preferenciák és a profilkivonat. A tömbmezők azonosító alapján egyesülnek (a meglévő felülíródik, az új hozzáadódik).",
		parameters: Type.Object({
			goals: Type.Optional(Type.Array(LearningGoalSchema)),
			knowledge_states: Type.Optional(Type.Array(KnowledgeStateSchema)),
			misconceptions: Type.Optional(Type.Array(MisconceptionSchema)),
			preferences: Type.Optional(PreferencesSchema),
			profile_summary: Type.Optional(Type.String({ description: "Updated profile summary text" })),
		}),
		async execute(_toolCallId, params) {
			try {
				if (isEnabled && !isEnabled()) return disabledResult();
				const updated = updateProfile(dataDir, params);
				return {
					content: [
						{
							type: "text" as const,
							text: `A tanulói profil frissítve: ${updated.version} verzió`,
						},
					],
					details: { version: updated.version },
				};
			} catch (err) {
				logger.warn({ err, params }, "update_learner_profile tool failed");
				throw err;
			}
		},
	});

	const reviewLearnerProfileTool = defineTool({
		name: "review_learner_profile",
		label: "Review Learner Profile",
		description:
			"A teljes tanulói profil megjelenítése megtekintéshez, javításhoz vagy törléshez. Akkor hívd, ha a felhasználó meg szeretné nézni a tanulási állapotát.",
		parameters: Type.Object({}),
		async execute() {
			if (isEnabled && !isEnabled()) return disabledResult();
			const profile = loadProfile(dataDir);
			const summary = [
				`Tanuló azonosító: ${profile.learner_id}`,
				`Verzió: ${profile.version}`,
				`Frissítés ideje: ${profile.updated_at}`,
				``,
				`## Tanulási célok (${profile.goals.length})`,
				...profile.goals.map(
					(g) => `- [${g.status}] ${g.title} (prioritás: ${g.priority}, típus: ${g.type})`,
				),
				``,
				`## Tudásállapot (${profile.knowledge_states.length})`,
				...profile.knowledge_states.map(
					(ks) =>
						`- ${ks.concept_name} (${ks.concept_id}): elsajátítottság ${ks.mastery.toFixed(2)}, megbízhatóság ${ks.confidence.toFixed(2)}\n  Diagnózis: ${ks.diagnosis}`,
				),
				``,
				`## Tévhitek (${profile.misconceptions.length})`,
				...profile.misconceptions.map(
					(m) => `- [${m.status}] ${m.description} (súlyosság: ${m.severity.toFixed(2)})`,
				),
				``,
				`## Preferenciák`,
				`- Magyarázati stílus: ${profile.preferences.explanation_style.join(", ") || "Nincs beállítva"}`,
				`- Gyakorlási stílus: ${profile.preferences.practice_style.join(", ") || "Nincs beállítva"}`,
				`- Visszajelzési hangnem: ${profile.preferences.feedback_tone.join(", ") || "Nincs beállítva"}`,
				`- Kerülendő: ${profile.preferences.avoid.join(", ") || "Nincs beállítva"}`,
				``,
				`## Profilkivonat`,
				profile.profile_summary || "Nincs kivonat",
			];

			return {
				content: [{ type: "text" as const, text: summary.join("\n") }],
				details: {},
			};
		},
	});

	return [
		getLearnerContextTool,
		recordLearningEventTool,
		patchLearnerProfileTool,
		updateLearnerProfileTool,
		reviewLearnerProfileTool,
	];
}
