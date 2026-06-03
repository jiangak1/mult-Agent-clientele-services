"use client";

import { useI18n, type Locale } from "@/lib/i18n/context";

const label: Record<Locale, string> = {
  zh: "中",
  en: "EN",
};

const next: Record<Locale, Locale> = {
  zh: "en",
  en: "zh",
};

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <button
      className="glass-btn"
      onClick={() => setLocale(next[locale])}
      title={locale === "zh" ? "Switch to English" : "切换到中文"}
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "4px 10px",
        minWidth: 36,
        letterSpacing: 0.5,
      }}
    >
      {label[locale]}
    </button>
  );
}
