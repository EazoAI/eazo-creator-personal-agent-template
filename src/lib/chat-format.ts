import type { TFunction } from "i18next";

import type { LocaleCode } from "@/i18n";
import type { MuseSession } from "@/shared/muse-events";

export function todayLabel(t: TFunction) {
  const h = new Date().getHours();
  if (h < 11) return t("today.morning");
  if (h < 18) return t("today.day");
  return t("today.evening");
}

export function sessionLabel(s: MuseSession, t: TFunction): string {
  const title = (s.title ?? "").trim();
  return title || t("session.untitled");
}

export function formatWhen(iso: string, locale: LocaleCode, t: TFunction): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("time.justNow");
  if (min < 60) return t("time.minutesAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("time.hoursAgo", { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t("time.daysAgo", { n: day });
  return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US");
}
