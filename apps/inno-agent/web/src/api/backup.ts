import { apiFetch, ApiError } from "./client.js";

export interface BackupImportResult {
	status: "restored";
	createdAt: string;
	counts: Record<string, number>;
	movedAside: string[];
	notes: string[];
}

/** Download the full student state as a ZIP file (browser-side download). */
export async function exportBackup(): Promise<{ blob: Blob; filename: string }> {
	const res = await fetch("/api/backup/export");
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new ApiError(res.status, (body as Record<string, string>).error || res.statusText);
	}
	const blob = await res.blob();
	const disposition = res.headers.get("Content-Disposition") ?? "";
	const match = /filename="?([^";]+)"?/.exec(disposition);
	return { blob, filename: match?.[1] ?? "inno-agent-mentes.zip" };
}

/** Restore the student state from an uploaded ZIP file. */
export async function importBackup(file: File | Blob): Promise<BackupImportResult> {
	return apiFetch<BackupImportResult>("/api/backup/import", {
		method: "POST",
		headers: { "Content-Type": "application/zip" },
		body: file,
	});
}
