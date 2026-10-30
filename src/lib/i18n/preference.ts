import { normalizeLocale, type LocaleCode } from "@/lib/i18n/locale";

export const LOCALE_STORAGE_KEY = "muse.locale.v1";

export function detectSystemLocale(): LocaleCode {
  const browserLanguages =
    typeof navigator !== "undefined" ? [navigator.language, ...(navigator.languages ?? [])] : [];
  for (const language of browserLanguages) {
    const locale = normalizeLocale(language);
    if (locale) return locale;
  }
  return "en";
}

export function getStoredLocale(): LocaleCode {
  if (typeof localStorage === "undefined") return detectSystemLocale();
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return normalizeLocale(raw) ?? detectSystemLocale();
  } catch {
    return detectSystemLocale();
  }
}

export function persistLocale(locale: LocaleCode): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.cookie = `${LOCALE_STORAGE_KEY}=${encodeURIComponent(locale)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }
}
