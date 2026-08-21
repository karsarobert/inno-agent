import { Play } from "lucide-react";
import { useCallback } from "react";
import { terminalStore } from "../../stores/terminal-store.js";
import { sessionsStore } from "../../stores/sessions-store.js";
import { workspaceStore } from "../../stores/workspace-store.js";
import { defaultRunCommand } from "../../utils/run-command.js";
import { useStoreSnapshot } from "../hooks.js";

interface RunButtonProps {
	filePath: string;
	className?: string;
}

export function RunButton({ filePath, className }: RunButtonProps) {
	const command = defaultRunCommand(filePath);
	const sessionId = useStoreSnapshot(sessionsStore, () => sessionsStore.currentSessionId);
	const workspaceId = useStoreSnapshot(workspaceStore, () => workspaceStore.activeWorkspaceId ?? undefined);
	const terminalStatus = useStoreSnapshot(terminalStore, () => terminalStore.status);
	const disabled = terminalStatus === "connecting" || terminalStatus === "running";
	const handleClick = useCallback(() => {
		if (!command || !sessionId || disabled) return;
		terminalStore.setOpen(true);
		terminalStore.runCommand(command, filePath, { sessionId, workspaceId });
	}, [command, disabled, filePath, sessionId, workspaceId]);

	if (!command) return null;

	return (
		<button
			onClick={handleClick}
			disabled={disabled}
			className={
				className ??
				"flex h-7 items-center gap-1 rounded-md border border-[var(--inno-border)] bg-[var(--inno-surface)] px-2 text-xs font-medium text-[var(--inno-text)] transition-colors hover:border-[var(--inno-success-border)] hover:bg-[var(--inno-success-bg)] hover:text-[var(--inno-success)]"
			}
			title={disabled ? "A program már fut vagy a terminál kapcsolódik" : `Run: ${command}`}
		>
			<Play size={12} />
			Run
		</button>
	);
}
