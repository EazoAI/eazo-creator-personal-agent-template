import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { localeCodes, normalizeLocale, type LocaleCode } from "@/lib/i18n/locale";
import { detectSystemLocale, getStoredLocale, persistLocale } from "@/lib/i18n/preference";

import en from "./locales/en.json";
import zh from "./locales/zh.json";

export type { LocaleCode };
export { localeCodes, normalizeLocale, detectSystemLocale, getStoredLocale };

const resources = {
  en: { translation: en },
  zh: { translation: zh },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  supportedLngs: [...localeCodes],
  interpolation: {
    escapeValue: false,
    prefix: "{",
    suffix: "}",
  },
});

export function syncDocumentLanguage(language: string) {
  const locale = normalizeLocale(language) ?? "en";
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }
}

export default i18n;

export function getResolvedLocale(): LocaleCode {
  return normalizeLocale(i18n.resolvedLanguage || i18n.language) ?? "en";
}

export async function changeLocale(locale: LocaleCode): Promise<void> {
  persistLocale(locale);
  await i18n.changeLanguage(locale);
  syncDocumentLanguage(i18n.language);
  window.dispatchEvent(new CustomEvent("muse-locale-changed", { detail: locale }));
}

/** Apply stored locale after hydration (call once from I18nProvider). */
export async function applyStoredLocale(): Promise<void> {
  const locale = getStoredLocale();
  await i18n.changeLanguage(locale);
  syncDocumentLanguage(i18n.language);
}
