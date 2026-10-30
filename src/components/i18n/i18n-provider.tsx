"use client";

import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";

import i18n, { applyStoredLocale } from "@/i18n";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void applyStoredLocale();
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
