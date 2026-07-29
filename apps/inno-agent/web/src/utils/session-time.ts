export function formatSessionTime(iso: string, locale: string, now: Date = new Date()): string {
	try {
		const date = new Date(iso);
		const isToday = date.toDateString() === now.toDateString();
		return date.toLocaleString(locale, isToday
			? { hour: "2-digit", minute: "2-digit" }
			: { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
		);
	} catch {
		return iso;
	}
}
