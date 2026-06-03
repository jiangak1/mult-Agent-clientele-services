"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";
import { ConfirmDialog } from "./confirm-dialog";

interface SidebarProps {
  activeConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  refreshKey?: number;
}

interface Conversation {
  id: string;
  intent: string | null;
  title: string | null;
  updatedAt: string;
  lastMessage: string;
}

export function Sidebar({ activeConversationId, onSelectConversation, onNewConversation, refreshKey }: SidebarProps) {
  const { t } = useI18n();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations?userId=00000000-0000-0000-0000-000000000101", {
        headers: {
          "x-tenant-id": "00000000-0000-0000-0000-000000000001",
          "x-user-id": "00000000-0000-0000-0000-000000000101",
        },
      });
      const data = await res.json();
      if (data.success) setConversations(data.data);
    } catch {
      // Silently fail - demo mode
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations, refreshKey]);

  const handleDelete = async (keepSolution: boolean) => {
    if (!deleteTarget) return;
    setDeleting(true);

    try {
      const res = await fetch(
        `/api/conversations?conversationId=${deleteTarget.id}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-tenant-id": "00000000-0000-0000-0000-000000000001",
            "x-user-id": "00000000-0000-0000-0000-000000000101",
          },
          body: JSON.stringify({ keepSolution }),
        },
      );
      const data = await res.json();
      if (data.success) {
        setConversations((prev) => prev.filter((c) => c.id !== deleteTarget.id));
        if (activeConversationId === deleteTarget.id) {
          onSelectConversation("");
        }
      }
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <aside className="glass-surface" style={{
        width: 280,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--glass-border)",
        borderRadius: 0,
        flexShrink: 0,
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 16px",
          borderBottom: "1px solid var(--glass-border)",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
          }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 700,
            }}>
              C
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{t("sidebar.title")}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("sidebar.subtitle")}</div>
            </div>
            <ThemeSwitcher />
            <LanguageSwitcher />
          </div>

          <button
            className="glass-btn glass-btn-primary"
            onClick={onNewConversation}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {t("sidebar.newChat")}
          </button>
        </div>

        {/* Conversation List */}
        <div style={{ flex: 1, overflow: "auto", padding: "12px 8px" }}>
          {conversations.length === 0 && (
            <div style={{
              textAlign: "center",
              padding: "32px 16px",
              color: "var(--text-muted)",
              fontSize: 13,
            }}>
              {t("sidebar.noConversations")}
              <br />
              {t("sidebar.noConversationsHint")}
            </div>
          )}

          {conversations.map((conv) => (
            <div
              key={conv.id}
              onMouseEnter={() => setHoveredId(conv.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{ position: "relative" }}
            >
              <div
                onClick={() => onSelectConversation(conv.id)}
                style={{
                  padding: "12px 36px 12px 12px",
                  marginBottom: 4,
                  borderRadius: 12,
                  cursor: "pointer",
                  background: activeConversationId === conv.id
                    ? "rgba(108, 140, 255, 0.1)"
                    : "transparent",
                  border: activeConversationId === conv.id
                    ? "1px solid rgba(108, 140, 255, 0.2)"
                    : "1px solid transparent",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {conv.title || conv.lastMessage || (t("sidebar.newChat") as string)}
                </div>
                {conv.title && conv.lastMessage && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {conv.lastMessage}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {conv.intent && (
                    <span className="agent-badge" style={{ fontSize: 10 }}>
                      {conv.intent}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {new Date(conv.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Delete button */}
              {hoveredId === conv.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(conv);
                  }}
                  title={t("dialog.confirm") as string}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    background: "rgba(239, 68, 68, 0.15)",
                    color: "rgba(239, 68, 68, 0.9)",
                    cursor: "pointer",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                    transition: "all 0.15s ease",
                  }}
                >
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--glass-border)",
          fontSize: 11,
          color: "var(--text-muted)",
          display: "flex",
          justifyContent: "space-between",
        }}>
          <span>{t("sidebar.tenant")}: demo-tenant</span>
          <span>{t("sidebar.version")}</span>
        </div>
      </aside>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        key={deleteTarget?.id ?? "dialog"}
        open={deleteTarget !== null}
        title={t("dialog.deleteTitle") as string}
        message={deleting ? (t("dialog.deleting") as string) : (t("dialog.deleteMessage") as string)}
        checkboxLabel={t("dialog.keepSolution") as string}
        confirmLabel={deleting ? undefined : (t("dialog.confirm") as string)}
        cancelLabel={t("dialog.cancel") as string}
        onConfirm={(keepSolution) => {
          if (!deleting) handleDelete(keepSolution);
        }}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </>
  );
}
