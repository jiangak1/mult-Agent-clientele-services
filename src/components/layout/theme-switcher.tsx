"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme, type ThemeId } from "@/lib/theme/context";
import { useI18n } from "@/lib/i18n/context";

const colorDot: Record<ThemeId, string> = {
  dark:  "linear-gradient(135deg, #1a1a22 40%, #6c8cff)",
  light: "linear-gradient(135deg, #e8e8ec 40%, #4f6ef6)",
  red:   "linear-gradient(135deg, #3a1a1e 40%, #f87171)",
  gray:  "linear-gradient(135deg, #2a2a30 40%, #a0a0b0)",
  blue:  "linear-gradient(135deg, #0d1838 40%, #60a5fa)",
};

export function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme();
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [showLabel, setShowLabel] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const current = themes.find((tItem) => tItem.id === theme) ?? themes[0];

  const isZh = locale === "zh";
  const label = (tItem: typeof themes[0]): string =>
    isZh ? tItem.nameZh : tItem.nameEn;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={isZh ? "切换主题" : "Switch theme"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          borderRadius: 10,
          border: "1px solid var(--glass-border)",
          background: "var(--glass-bg)",
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "inherit",
          transition: "all 0.2s ease",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 15,
            height: 15,
            borderRadius: 4,
            background: colorDot[theme],
            border: "1px solid var(--glass-border)",
            flexShrink: 0,
          }}
        />
        <span style={{ color: "var(--text-primary)" }}>{label(current)}</span>
      </button>

      {open && (
        <div
          className="glass-elevated"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 100,
            minWidth: 150,
            padding: "6px",
            borderRadius: 14,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          {themes.map((tItem) => (
            <button
              key={tItem.id}
              onClick={() => {
                setTheme(tItem.id);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 10,
                border: "none",
                background: tItem.id === theme ? "var(--btn-bg)" : "transparent",
                color: tItem.id === theme ? "var(--accent-primary)" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                transition: "all 0.15s ease",
                fontFamily: "inherit",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  background: colorDot[tItem.id],
                  border: "1px solid var(--glass-border)",
                  flexShrink: 0,
                }}
              />
              {label(tItem)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
