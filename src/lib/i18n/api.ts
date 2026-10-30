import en from "@/i18n/locales/en.json";

type ApiKey = keyof typeof en.api;

function getPath(obj: Record<string, unknown>, path: string): string | undefined {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
  return typeof value === "string" ? value : undefined;
}

/** API error / validation messages are always English. */
export function apiMessage(key: ApiKey): string {
  return getPath(en as Record<string, unknown>, `api.${key}`) ?? key;
}
