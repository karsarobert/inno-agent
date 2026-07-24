import { useSyncExternalStore } from "react";

export const CONTENT_LOCALES = ["zh-CN", "en", "hu"] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

const STORAGE_KEY = "inno.content-locale";
const CHANGE_EVENT = "inno-content-locale-change";

function isContentLocale(value: string | null): value is ContentLocale {
	return value === "zh-CN" || value === "en" || value === "hu";
}

export function getContentLocale(): ContentLocale {
	if (typeof window === "undefined") return "en";
	try {
		const saved = window.localStorage.getItem(STORAGE_KEY);
		return isContentLocale(saved) ? saved : "en";
	} catch {
		return "en";
	}
}

export function setContentLocale(locale: ContentLocale): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, locale);
	} catch {
		// The custom event still updates this tab if browser storage is blocked.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onStoreChange: () => void): () => void {
	window.addEventListener(CHANGE_EVENT, onStoreChange);
	const onStorage = (event: StorageEvent) => {
		if (event.key === STORAGE_KEY) onStoreChange();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(CHANGE_EVENT, onStoreChange);
		window.removeEventListener("storage", onStorage);
	};
}

export function useContentLocale(): ContentLocale {
	return useSyncExternalStore(subscribe, getContentLocale, () => "en");
}
