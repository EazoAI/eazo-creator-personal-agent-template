"use client";

import { useTranslation } from "react-i18next";

import { changeLocale, normalizeLocale, type LocaleCode } from "@/i18n";

export function LangSwitcher() {
  const { t, i18n } = useTranslation();
  const locale = (normalizeLocale(i18n.resolvedLanguage || i18n.language) ?? "en") as LocaleCode;
  const next: LocaleCode = locale === "en" ? "zh" : "en";
  const label = locale === "en" ? t("lang.switchToZh") : t("lang.switchToEn");

  return (
    <button
      type="button"
      className="lang-switch"
      aria-label={t("lang.label")}
      title={label}
      onClick={() => void changeLocale(next)}
    >
      {label}
    </button>
  );
}
