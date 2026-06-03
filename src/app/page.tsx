"use client";

import { useState, useCallback } from "react";
import { ThemeProvider } from "@/lib/theme/context";
import { I18nProvider } from "@/lib/i18n/context";
import { Sidebar } from "@/components/layout/sidebar";
import { ChatArea } from "@/components/chat/chat-area";
import { AgentPanel } from "@/components/chat/agent-panel";
import { ProductPanel } from "@/components/chat/product-panel";

export default function Home() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [showProductPanel, setShowProductPanel] = useState(false);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  const refreshSidebar = useCallback(() => {
    setSidebarRefreshKey((k) => k + 1);
  }, []);

  const handleConversationCreated = useCallback((id: string) => {
    setConversationId(id);
    refreshSidebar();
  }, [refreshSidebar]);

  const handleNewConversation = useCallback(() => {
    setConversationId(null);
  }, []);

  return (
    <ThemeProvider>
      <I18nProvider>
        <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
          <Sidebar
            activeConversationId={conversationId ?? undefined}
            onSelectConversation={setConversationId}
            onNewConversation={handleNewConversation}
            refreshKey={sidebarRefreshKey}
          />

          <ChatArea
            conversationId={conversationId}
            onConversationCreated={handleConversationCreated}
            onToggleAgentPanel={() => setShowAgentPanel((v) => !v)}
            onToggleProductPanel={() => setShowProductPanel((v) => !v)}
          />

          {showProductPanel && (
            <ProductPanel onClose={() => setShowProductPanel(false)} />
          )}

          {showAgentPanel && (
            <AgentPanel onClose={() => setShowAgentPanel(false)} />
          )}
        </div>
      </I18nProvider>
    </ThemeProvider>
  );
}
