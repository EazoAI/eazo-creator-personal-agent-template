export const localeCodes = ["en", "zh"] as const;
export type LocaleCode = (typeof localeCodes)[number];

const localeSet = new Set<string>(localeCodes);

export function normalizeLocale(value: string | null | undefined): LocaleCode | null {
  if (!value) return null;
  if (localeSet.has(value)) return value as LocaleCode;
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("en")) return "en";
  return null;
}
