import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN.json";
import en from "./locales/en.json";
import hu from "./locales/hu.json";

const STORAGE_KEY = "inno.locale";

function syncDocumentLanguage(locale: string): void {
	if (typeof document !== "undefined") document.documentElement.lang = locale;
}

function getInitialLocale(): string {
	if (typeof window === "undefined") return "zh-CN";
	try {
		const saved = window.localStorage.getItem(STORAGE_KEY);
		if (saved === "zh-CN" || saved === "en" || saved === "hu") return saved;
	} catch {
		// Storage can be unavailable in privacy-restricted browser contexts.
	}
	return "zh-CN";
}

void i18n.use(initReactI18next).init({
	resources: {
		"zh-CN": { translation: zhCN },
		en: { translation: en },
		hu: { translation: hu },
	},
	lng: getInitialLocale(),
	fallbackLng: "zh-CN",
	interpolation: { escapeValue: false },
	returnNull: false,
});

i18n.on("languageChanged", syncDocumentLanguage);
syncDocumentLanguage(getInitialLocale());

export function setLocale(lng: "zh-CN" | "en" | "hu"): void {
	void i18n.changeLanguage(lng);
	syncDocumentLanguage(lng);
	if (typeof window !== "undefined") {
		try {
			window.localStorage.setItem(STORAGE_KEY, lng);
		} catch {
			// The active tab still uses the new locale when persistence is blocked.
		}
	}
}

export function currentLocale(): string {
	return i18n.language || "zh-CN";
}

export default i18n;
