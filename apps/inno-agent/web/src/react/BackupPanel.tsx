import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload, Loader2, HardDriveDownload } from "lucide-react";
import { exportBackup, importBackup } from "../api/backup.js";

/**
 * Save/restore the full student state (conversations, memory, workspaces,
 * settings) to/from a single ZIP file. Rendered in two sizes:
 *  - full: a settings card (teacher view)
 *  - compact: a two-button row for the session sidebar (student view, works
 *    in Simple Mode too)
 */
export function BackupPanel({ compact = false }: { compact?: boolean }) {
	const { t } = useTranslation();
	const fileRef = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState<"export" | "import" | null>(null);
	const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

	const handleExport = useCallback(async () => {
		setBusy("export");
		setMessage(null);
		try {
			const { blob, filename } = await exportBackup();
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = filename;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(url);
			setMessage({
				kind: "ok",
				text: t("settings.backup.exportDone", "A mentés elkészült ({{name}}).", { name: filename }),
			});
		} catch (err) {
			setMessage({
				kind: "err",
				text: `${t("settings.backup.exportFailed", "A mentés nem sikerült.")} ${err instanceof Error ? err.message : String(err)}`,
			});
		} finally {
			setBusy(null);
		}
	}, [t]);

	const handleImportFile = useCallback(
		async (file: File) => {
			const confirmed = window.confirm(
				t(
					"settings.backup.importConfirm",
					"A betöltés felülírja a jelenlegi állapotot (beszélgetések, memória, munkaterületek). A jelenlegi adatok biztonsági mappába kerülnek. Folytatod?",
				),
			);
			if (!confirmed) return;
			setBusy("import");
			setMessage(null);
			try {
				const result = await importBackup(file);
				const count = Object.values(result.counts ?? {}).reduce((a, b) => a + b, 0);
				setMessage({
					kind: "ok",
					text: t("settings.backup.importDone", "Sikeres visszaállítás ({{count}} fájl) — az oldal újratöltődik…", { count }),
				});
				// The server keeps running; reload so the UI re-reads the
				// restored sessions/workspaces/memory from disk.
				setTimeout(() => window.location.reload(), 1200);
			} catch (err) {
				const e = err as { status?: number; message?: string };
				const text =
					e.status === 409
						? t("settings.backup.importBusy", "Egy feladat éppen fut — várd meg, amíg befejeződik, majd próbáld újra.")
						: `${t("settings.backup.importFailed", "A betöltés nem sikerült.")} ${e.message ?? ""}`;
				setMessage({ kind: "err", text });
			} finally {
				setBusy(null);
			}
		},
		[t],
	);

	const pickFile = useCallback(() => {
		if (busy !== null) return;
		fileRef.current?.click();
	}, [busy]);

	const importInput = (
		<input
			ref={fileRef}
			type="file"
			accept=".zip,application/zip"
			className="hidden"
			onChange={(e) => {
				const file = e.target.files?.[0];
				e.target.value = "";
				if (file) void handleImportFile(file);
			}}
		/>
	);

	if (compact) {
		return (
			<div className="mb-2">
				<div className="flex gap-1.5">
					<button
						type="button"
						onClick={() => void handleExport()}
						disabled={busy !== null}
						title={t("settings.backup.export", "Mentés fájlba")}
						className="inno-sidebar-text flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--inno-border)] bg-[var(--inno-surface)] px-2 py-1.5 text-xs text-[var(--inno-text-muted)] transition-colors hover:border-[var(--inno-accent)] hover:text-[var(--inno-accent)] disabled:cursor-wait disabled:opacity-60"
					>
						{busy === "export" ? <Loader2 size={13} className="animate-spin" /> : <HardDriveDownload size={13} />}
						{t("settings.backup.exportShort", "Mentés")}
					</button>
					<button
						type="button"
						onClick={pickFile}
						disabled={busy !== null}
						title={t("settings.backup.import", "Betöltés fájlból")}
						className="inno-sidebar-text flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--inno-border)] bg-[var(--inno-surface)] px-2 py-1.5 text-xs text-[var(--inno-text-muted)] transition-colors hover:border-[var(--inno-accent)] hover:text-[var(--inno-accent)] disabled:cursor-wait disabled:opacity-60"
					>
						{busy === "import" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
						{t("settings.backup.importShort", "Betöltés")}
					</button>
				</div>
				{importInput}
				{message ? (
					<div
						className={`mt-1.5 rounded px-2 py-1 text-[11px] leading-snug ${
							message.kind === "ok" ? "bg-[var(--inno-success-bg)] text-[var(--inno-success)]" : "bg-[var(--inno-danger-bg)] text-[var(--inno-danger)]"
						}`}
					>
						{message.text}
					</div>
				) : null}
			</div>
		);
	}

	return (
		<div className="rounded-lg bg-[var(--inno-surface)] p-4">
			<div className="mb-1 flex items-center gap-2">
				<Download size={16} className="text-[var(--inno-accent)]" />
				<h4 className="text-sm font-medium text-[var(--inno-text)]">{t("settings.backup.title", "Állapot mentése és visszaállítása")}</h4>
			</div>
			<p className="mb-3 text-xs leading-relaxed text-[var(--inno-text-muted)]">
				{t(
					"settings.backup.desc",
					"Mindent egy fájlba ment: beszélgetéseket, memóriát, munkaterületeket és beállításokat. A mentés másik gépre vihető (pl. USB-n), és betöltéssel onnan folytathatod, ahol abbahagytad. A betöltés felülírja a jelenlegi állapotot; a régi adatok biztonsági mappába kerülnek.",
				)}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => void handleExport()}
					disabled={busy !== null}
					className="inline-flex items-center gap-1.5 rounded-md border border-[var(--inno-border)] bg-[var(--inno-surface)] px-3 py-1.5 text-sm text-[var(--inno-text)] transition-colors hover:border-[var(--inno-accent)] hover:text-[var(--inno-accent)] disabled:cursor-wait disabled:opacity-60"
				>
					{busy === "export" ? <Loader2 size={14} className="animate-spin" /> : <HardDriveDownload size={14} />}
					{t("settings.backup.export", "Mentés fájlba")}
				</button>
				<button
					type="button"
					onClick={pickFile}
					disabled={busy !== null}
					className="inline-flex items-center gap-1.5 rounded-md border border-[var(--inno-border)] bg-[var(--inno-surface)] px-3 py-1.5 text-sm text-[var(--inno-text)] transition-colors hover:border-[var(--inno-accent)] hover:text-[var(--inno-accent)] disabled:cursor-wait disabled:opacity-60"
				>
					{busy === "import" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
					{t("settings.backup.import", "Betöltés fájlból")}
				</button>
				{importInput}
			</div>
			{message ? (
				<div
					className={`mt-2 rounded px-2 py-1.5 text-xs ${
						message.kind === "ok" ? "bg-[var(--inno-success-bg)] text-[var(--inno-success)]" : "bg-[var(--inno-danger-bg)] text-[var(--inno-danger)]"
					}`}
				>
					{message.text}
				</div>
			) : null}
		</div>
	);
}
