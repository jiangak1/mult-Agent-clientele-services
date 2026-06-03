"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  checkboxLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (keepSolution: boolean) => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  checkboxLabel,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const [keepSolution, setKeepSolution] = useState(true);

  if (!open) return null;

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-elevated"
        style={{
          width: 380,
          padding: "24px 28px",
          borderRadius: 16,
          border: "1px solid var(--glass-border)",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          {title || (t("dialog.deleteTitle") as string)}
        </div>
        <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 20 }}>
          {message || (t("dialog.deleteMessage") as string)}
        </div>

        {checkboxLabel !== undefined && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 20,
              cursor: "pointer",
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            <input
              type="checkbox"
              checked={keepSolution}
              onChange={(e) => setKeepSolution(e.target.checked)}
              style={{
                width: 16,
                height: 16,
                accentColor: "var(--accent-primary)",
                cursor: "pointer",
              }}
            />
            {checkboxLabel || (t("dialog.keepSolution") as string)}
          </label>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            className="glass-btn"
            onClick={onCancel}
            style={{ fontSize: 13, padding: "8px 20px" }}
          >
            {cancelLabel || (t("dialog.cancel") as string)}
          </button>
          <button
            onClick={() => onConfirm(keepSolution)}
            style={{
              fontSize: 13,
              padding: "8px 20px",
              borderRadius: 10,
              border: "none",
              background: "rgba(239, 68, 68, 0.8)",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            {confirmLabel || (t("dialog.confirm") as string)}
          </button>
        </div>
      </div>
    </div>
  );
}
