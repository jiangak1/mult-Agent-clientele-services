"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { StreamEvent } from "@/types";

interface UseSocketOptions {
  tenantId: string;
  userId: string;
  conversationId: string | null;
  onStreamEvent: (event: StreamEvent) => void;
}

interface UseSocketReturn {
  isConnected: boolean;
  sendMessage: (message: string, imageUrls?: string[]) => void;
  sendTyping: (isTyping: boolean) => void;
}

export function useSocket(options: UseSocketOptions): UseSocketReturn {
  const { tenantId, userId, conversationId, onStreamEvent } = options;
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<ReturnType<typeof import("socket.io-client").io> | null>(null);

  useEffect(() => {
    let mounted = true;

    const initSocket = async () => {
      try {
        const { io } = await import("socket.io-client");

        const socket = io(window.location.origin, {
          auth: { tenantId, userId },
          query: conversationId ? { conversationId } : {},
          transports: ["websocket", "polling"],
        });

        socket.on("connect", () => {
          if (mounted) setIsConnected(true);
        });

        socket.on("disconnect", () => {
          if (mounted) setIsConnected(false);
        });

        socket.on("connect_error", () => {
          if (mounted) setIsConnected(false);
        });

        socket.on("stream:event", (event: StreamEvent) => {
          onStreamEvent(event);
        });

        socket.on("conversation:created", (data: { conversationId: string }) => {
          // Conversation created on server — parent handles via onConversationCreated prop
        });

        socketRef.current = socket;
      } catch {
        // Socket.IO not available — fall back to REST mode
        if (mounted) setIsConnected(false);
      }
    };

    initSocket();

    return () => {
      mounted = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [tenantId, userId, conversationId, onStreamEvent]);

  const sendMessage = useCallback((message: string, imageUrls?: string[]) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("chat:message", {
        message,
        imageUrls,
        conversationId,
      });
    }
  }, [conversationId]);

  const sendTyping = useCallback((isTyping: boolean) => {
    if (socketRef.current?.connected && conversationId) {
      socketRef.current.emit("chat:typing", {
        conversationId,
        isTyping,
      });
    }
  }, [conversationId]);

  return { isConnected, sendMessage, sendTyping };
}
