import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { JobStore } from "./job-store.js";
import type { ScheduledJob } from "./types.js";
import type { ChannelRegistry } from "../channels/channel.js";
import { executeJob } from "./job-runner.js";
import { validateCron } from "./cron-utils.js";

/**
 * Create scheduler tools that allow the agent to manage scheduled jobs.
 * Works in both CLI and server contexts.
 */
export function createSchedulerTools(jobStore: JobStore, channelRegistry?: ChannelRegistry): ToolDefinition[] {
	const createJobTool = defineTool({
		name: "create_scheduled_job",
		label: "Create Scheduled Job",
		description:
			"Ütemezett feladat létrehozása. Akkor hívd, ha a felhasználó azt mondja: „minden este 9-kor emlékeztess a tanulásra” vagy „állíts be heti összefoglalót”. Cron-példa: '0 21 * * *' = minden nap 21:00, '0 9 * * 1' = minden hétfő 9:00.",
		parameters: Type.Object({
			name: Type.String({ description: "Feladat neve" }),
			cron: Type.String({ description: "Cron kifejezés, pl. '0 21 * * *'" }),
			taskType: StringEnum([
				"daily_review",
				"weekly_summary",
				"learner_profile_reflection",
				"spaced_review",
				"push_reminder",
				"custom_prompt",
			] as const, { description: "Feladat típusa" }),
			prompt: Type.String({ description: "A feladat futtatásakor az agentnek küldött utasítás" }),
			channel: Type.Optional(StringEnum(["feishu", "qq", "wechat", "wecom"] as const, {
				description: "Az eredmény célcsatornája (opcionális)",
			})),
			chatId: Type.Optional(Type.String({ description: "A cél chat_id (opcionális)" })),
		}),
		async execute(_toolCallId, params) {
			const cronCheck = validateCron(params.cron);
			if (!cronCheck.ok) {
				return {
					content: [{
						type: "text" as const,
						text: `Érvénytelen cron kifejezés: ${cronCheck.error}. Használj 5 mezős kifejezést, pl. '30 14 28 2 *', és próbáld újra.`,
					}],
					details: { error: "invalid_cron" } as Record<string, unknown>,
				};
			}
			if (params.channel && !channelRegistry?.get(params.channel)) {
				return {
					content: [{
						type: "text" as const,
						text: `A(z) „${params.channel}” csatorna még nincs regisztrálva (a felhasználó nem engedélyezte). Kérd meg a felhasználót, hogy engedélyezze és állítsa be a(z) ${params.channel} csatornát a Beállításokban, vagy módosítsd a feladatot channel nélkülire (csak alkalmazáson belüli emlékeztető).`,
					}],
					details: { error: "channel_not_registered", channel: params.channel } as Record<string, unknown>,
				};
			}
			const defaultTarget = params.channel ? channelRegistry?.getDefaultTarget(params.channel) : undefined;
			const job = jobStore.create({
				name: params.name,
				cron: params.cron,
				timezone: "Asia/Shanghai",
				enabled: true,
				taskType: params.taskType,
				prompt: params.prompt,
				channel: params.channel,
				target: params.channel && params.chatId
					? { channel: params.channel, chatId: params.chatId }
					: defaultTarget,
			});

			return {
				content: [{
					type: "text" as const,
					text: `Ütemezett feladat létrehozva: ${job.name} (${job.id})\nCron: ${job.cron}\nTípus: ${job.taskType}\nKövetkező futtatás: ${job.nextRunAt ?? "Nem számítható; ellenőrizd a cron kifejezést"}\n\nMondhatod azt, hogy „futtasd ezt a feladatot”, hogy azonnal lefusson, vagy várd meg, amíg a háttér-ütemező automatikusan elindítja.`,
				}],
				details: { jobId: job.id } as Record<string, unknown>,
			};
		},
	});

	const listJobsTool = defineTool({
		name: "list_scheduled_jobs",
		label: "List Scheduled Jobs",
		description: "Az összes ütemezett feladat listázása. Akkor hívd, ha a felhasználó megkérdezi: „milyen ütemezett feladataim vannak” vagy „mutasd az ütemezett feladatokat”.",
		parameters: Type.Object({}),
		async execute() {
			const jobs = jobStore.list();
			if (jobs.length === 0) {
				return {
					content: [{ type: "text" as const, text: "Jelenleg nincs ütemezett feladat." }],
					details: {},
				};
			}

			const lines = jobs.map((j: ScheduledJob) =>
				`- [${j.enabled ? "Engedélyezve" : "Letiltva"}] ${j.name} (${j.id})\n  Cron: ${j.cron} | Típus: ${j.taskType}\n  Állapot: ${j.lastStatus ?? "Nem futott"} | sikeres/sikertelen: ${Math.max(0, j.runCount - j.failureCount)}/${j.failureCount}\n  Legutóbbi futtatás: ${j.lastRunAt ?? "Soha"}\n  Következő futtatás: ${j.nextRunAt ?? "Nem számított"}`,
			);

			return {
				content: [{ type: "text" as const, text: `Ütemezett feladatok (${jobs.length}):\n\n${lines.join("\n\n")}` }],
				details: {},
			};
		},
	});

	const updateJobTool = defineTool({
		name: "update_scheduled_job",
		label: "Update Scheduled Job",
		description: "Ütemezett feladat frissítése vagy letiltása. Módosítható a név, a cron, az engedélyezettség és az utasítás.",
		parameters: Type.Object({
			id: Type.String({ description: "Feladat azonosító" }),
			name: Type.Optional(Type.String({ description: "Új név" })),
			cron: Type.Optional(Type.String({ description: "Új cron kifejezés" })),
			enabled: Type.Optional(Type.Boolean({ description: "Engedélyezve van-e" })),
			prompt: Type.Optional(Type.String({ description: "Új utasítás" })),
		}),
		async execute(_toolCallId, params) {
			const { id, ...patch } = params;
			if (patch.cron !== undefined) {
				const cronCheck = validateCron(patch.cron);
				if (!cronCheck.ok) {
					return {
						content: [{
							type: "text" as const,
							text: `Érvénytelen cron kifejezés: ${cronCheck.error}. A feladat nem lett frissítve.`,
						}],
						details: { error: "invalid_cron" } as Record<string, unknown>,
					};
				}
			}
			const updated = jobStore.update(id, patch);
			if (!updated) {
				return {
					content: [{ type: "text" as const, text: `A feladat nem található: ${id}` }],
					details: {} as Record<string, unknown>,
				};
			}
			return {
				content: [{ type: "text" as const, text: `A(z) ${updated.name} (${updated.id}) feladat frissítve.` }],
				details: {} as Record<string, unknown>,
			};
		},
	});

	const deleteJobTool = defineTool({
		name: "delete_scheduled_job",
		label: "Delete Scheduled Job",
		description: "Ütemezett feladat törlése.",
		parameters: Type.Object({
			id: Type.String({ description: "A törlendő feladat azonosítója" }),
		}),
		async execute(_toolCallId, params) {
			const deleted = jobStore.delete(params.id);
			return {
				content: [{
					type: "text" as const,
					text: deleted ? `A(z) ${params.id} feladat törölve.` : `A feladat nem található: ${params.id}`,
				}],
				details: {},
			};
		},
	});

	const runJobTool = defineTool({
		name: "run_scheduled_job",
		label: "Run Scheduled Job",
		description:
			"Ütemezett feladat azonnali futtatása. Akkor hívd, ha a felhasználó azt mondja: „futtasd azt az ismétlő feladatot” vagy „futtasd most a napi összefoglalót”. A feladatban definiált utasítás fut le, és az eredmény visszaadásra kerül.",
		parameters: Type.Object({
			id: Type.String({ description: "A futtatandó feladat azonosítója" }),
		}),
		async execute(_toolCallId, params) {
			const job = jobStore.get(params.id);
			if (!job) {
				return {
					content: [{ type: "text" as const, text: `A feladat nem található: ${params.id}` }],
					details: {},
				};
			}
			if (!channelRegistry) {
				return {
					content: [{
						type: "text" as const,
						text: "A jelenlegi futási környezetben nincs elérhető háttér-ChannelRegistry, így a feladat ténylegesen nem hajtható végre.",
					}],
					details: {},
				};
			}

			const result = await executeJob(job, jobStore, channelRegistry, "manual");
			return {
				content: [{
					type: "text" as const,
					text: result.success
						? `A(z) „${job.name}” feladat végrehajtása kész.\nRun: ${result.runId}\n${result.pushedToChannel ? `Küldve ide: ${result.pushedToChannel}\n` : ""}\nKimenet:\n${result.output ?? ""}`
						: `A(z) „${job.name}” feladat végrehajtása sikertelen.\nRun: ${result.runId}\nHiba: ${result.error}`,
				}],
				details: result,
			};
		},
	});

	return [createJobTool, listJobsTool, updateJobTool, deleteJobTool, runJobTool];
}
