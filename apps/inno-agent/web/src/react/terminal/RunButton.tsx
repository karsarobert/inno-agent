import { Play } from "lucide-react";
import { useCallback } from "react";
import { terminalStore } from "../../stores/terminal-store.js";
import { defaultRunCommand } from "../../utils/run-command.js";

interface RunButtonProps {
	filePath: string;
	className?: string;
}

export function RunButton({ filePath, className }: RunButtonProps) {
	const command = defaultRunCommand(filePath);
	const handleClick = useCallback(() => {
		if (!command) return;
		terminalStore.setOpen(true);
		terminalStore.runCommand(command, filePath);
	}, [command, filePath]);

	if (!command) return null;

	return (
		<button
			onClick={handleClick}
			className={
				className ??
				"flex h-7 items-center gap-1 rounded-md border border-[var(--inno-border)] bg-[var(--inno-surface)] px-2 text-xs font-medium text-[var(--inno-text)] transition-colors hover:border-[var(--inno-success-border)] hover:bg-[var(--inno-success-bg)] hover:text-[var(--inno-success)]"
			}
			title={`Run: ${command}`}
		>
			<Play size={12} />
			Run
		</button>
	);
}
