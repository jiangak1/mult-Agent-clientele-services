"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSocket } from "@/hooks/use-socket";
import { useI18n } from "@/lib/i18n/context";
import type { ChatMessage, StreamEvent } from "@/types";

interface ChatAreaProps {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  onToggleAgentPanel: () => void;
  onToggleProductPanel: () => void;
}

export function ChatArea({ conversationId, onConversationCreated, onToggleAgentPanel, onToggleProductPanel }: ChatAreaProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "agent_switch": {
        const data = event.data as { from: string | null; to: string };
        setCurrentAgent(data.to);
        break;
      }
      case "message": {
        const data = event.data as { content: string; agentType: string; metadata: Record<string, unknown> };
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_${Date.now()}`,
            conversationId: event.conversationId,
            role: "assistant",
            agentType: data.agentType,
            content: data.content,
            metadata: data.metadata as ChatMessage["metadata"],
            createdAt: new Date(),
          },
        ]);
        setIsProcessing(false);
        break;
      }
      case "error": {
        setIsProcessing(false);
        const data = event.data as { message: string };
        console.error("Stream error:", data.message);
        break;
      }
      case "done": {
        setIsProcessing(false);
        setCurrentAgent(null);
        break;
      }
    }
  }, []);

  const { isConnected, sendMessage, sendTyping } = useSocket({
    tenantId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000101",
    conversationId,
    onStreamEvent: handleStreamEvent,
  });

  // Load messages when conversation changes
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      try {
        const res = await fetch(`/api/chat?conversationId=${conversationId}`, {
          headers: {
            "x-tenant-id": "00000000-0000-0000-0000-000000000001",
            "x-user-id": "00000000-0000-0000-0000-000000000101",
          },
        });
        const data = await res.json();
        if (data.success && data.data) {
          setMessages(data.data.map((m: Record<string, unknown>) => ({
            id: m.id as string,
            conversationId: m.conversationId as string ?? conversationId,
            role: m.role as "user" | "assistant",
            agentType: m.agentType as string | undefined,
            content: m.content as string,
            metadata: (m.metadata ?? {}) as ChatMessage["metadata"],
            createdAt: new Date(m.createdAt as string),
          })));
        }
      } catch { /* demo mode */ }
    };

    loadMessages();
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() && imageFiles.length === 0) return;
    if (isProcessing) return;

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      conversationId: conversationId ?? "",
      role: "user",
      content: input,
      metadata: imagePreviews.length > 0 ? { imageUrls: imagePreviews } : {},
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsProcessing(true);

    let uploadedUrls: string[] = [];
    if (imageFiles.length > 0) {
      const formData = new FormData();
      imageFiles.forEach((f) => formData.append("files", f));
      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data.success) {
          uploadedUrls = data.data.urls;
        }
      } catch (err) {
        console.error("Upload failed:", err);
      }
      setImageFiles([]);
      setImagePreviews([]);
    }

    if (!isConnected) {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-tenant-id": "00000000-0000-0000-0000-000000000001",
            "x-user-id": "00000000-0000-0000-0000-000000000101",
          },
          body: JSON.stringify({
            message: input,
            conversationId,
            imageUrls: uploadedUrls.length > 0 ? uploadedUrls : undefined,
          }),
        });
        const data = await res.json();

        if (data.success && data.data) {
          if (!conversationId) {
            onConversationCreated(data.data.conversationId);
          }
          setMessages((prev) => [
            ...prev,
            {
              id: `msg_${Date.now()}`,
              conversationId: data.data.conversationId,
              role: "assistant",
              agentType: data.data.agentType,
              content: data.data.message,
              metadata: data.data.metadata,
              createdAt: new Date(),
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `msg_${Date.now()}`,
              conversationId: conversationId ?? "",
              role: "assistant",
              agentType: "error",
              content: data.error ?? "Request failed",
              metadata: {},
              createdAt: new Date(),
            },
          ]);
        }
      } catch (err) {
        console.error("Error:", err);
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_${Date.now()}`,
            conversationId: conversationId ?? "",
            role: "assistant",
            agentType: "error",
            content: "Network error. Please check your connection and try again.",
            metadata: {},
            createdAt: new Date(),
          },
        ]);
      }
      setIsProcessing(false);
      return;
    }

    sendMessage(input, uploadedUrls.length > 0 ? uploadedUrls : undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setImageFiles((prev) => [...prev, ...files]);
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImagePreviews((prev) => [...prev, ev.target?.result as string]);
      };
      reader.readAsDataURL(f);
    });
  };

  const removeImage = (index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      {/* Header */}
      <header className="glass-surface" style={{
        borderRadius: 0,
        borderBottom: "1px solid var(--glass-border)",
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {conversationId ? t("chat.header.active") : t("chat.header.new")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {isConnected ? t("chat.header.connected") : t("chat.header.restMode")}
            {currentAgent && (
              <span style={{ marginLeft: 8 }}>
                | {t("chat.header.agent")}: <span className="agent-badge">{currentAgent}</span>
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="glass-btn"
            onClick={onToggleProductPanel}
            style={{ fontSize: 13 }}
          >
            {t("chat.header.products")}
          </button>
          <button
            className="glass-btn"
            onClick={onToggleAgentPanel}
            style={{ fontSize: 13 }}
          >
            {t("chat.header.agents")}
          </button>
        </div>
      </header>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
          }}>
            <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>
              &#9679;&#9679;&#9679;
            </div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
              {t("chat.welcome.title")}
            </div>
            <div style={{ fontSize: 13, maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
              {t("chat.welcome.subtitle")}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={msg.id || i}
            className={msg.role === "user" ? "msg-user" : "msg-assistant"}
            style={{
              ...(msg.role === "user" ? { alignSelf: "flex-end" } : { alignSelf: "flex-start" }),
            }}
          >
            {msg.agentType && msg.role === "assistant" && (
              <div style={{ marginBottom: 6 }}>
                <span className="agent-badge">{msg.agentType}</span>
              </div>
            )}
            <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {msg.content}
            </div>
            {msg.metadata?.recommendations && Array.isArray(msg.metadata.recommendations) && (msg.metadata.recommendations as Array<{title: string; description: string}>).length > 0 && (
              <div style={{ marginTop: 8, borderTop: "1px solid var(--glass-border)", paddingTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-primary)", marginBottom: 4 }}>
                  {t("chat.recommendations")}
                </div>
                {(msg.metadata.recommendations as Array<{title: string; description: string}>).map((r, j) => (
                  <div key={j} style={{ fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{r.title}</span>: {r.description}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(msg.metadata?.imageUrls) && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                {(msg.metadata!.imageUrls as string[]).map((url, j) => (
                  <img
                    key={j}
                    src={url}
                    alt="Upload"
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: 8,
                      objectFit: "cover",
                      border: "1px solid var(--glass-border)",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {isProcessing && (
          <div className="msg-assistant" style={{ alignSelf: "flex-start" }}>
            <div className="typing-indicator">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Image Previews */}
      {imagePreviews.length > 0 && (
        <div style={{
          padding: "0 20px 8px",
          display: "flex",
          gap: 8,
        }}>
          {imagePreviews.map((preview, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img
                src={preview}
                alt={`Preview ${i}`}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 10,
                  objectFit: "cover",
                  border: "1px solid var(--glass-border)",
                }}
              />
              <button
                onClick={() => removeImage(i)}
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  border: "1px solid var(--glass-border)",
                  background: "rgba(0,0,0,0.6)",
                  color: "var(--text-primary)",
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                }}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div style={{
        padding: "12px 20px 20px",
        borderTop: "1px solid var(--glass-border)",
        background: "var(--surface-primary)",
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <button
            className="glass-btn"
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: "10px 12px", fontSize: 18 }}
            title={t("chat.input.attachImages") as string}
          >
            +
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageSelect}
            style={{ display: "none" }}
          />

          <textarea
            className="glass-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("chat.input.placeholder") as string}
            rows={1}
            style={{
              resize: "none",
              flex: 1,
              maxHeight: 120,
            }}
            disabled={isProcessing}
          />

          <button
            className="glass-btn glass-btn-primary"
            onClick={handleSend}
            disabled={!input.trim() && imageFiles.length === 0}
            style={{ alignSelf: "flex-end" }}
          >
            {t("chat.input.send")}
          </button>
        </div>
      </div>
    </main>
  );
}
