import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { processMessage, createConversation } from "@/lib/workflows/graph";
import { extractTenant } from "@/lib/auth/tenant-middleware";
import type { StreamEvent } from "@/types";

let io: SocketIOServer | null = null;

export function getIO(): SocketIOServer | null {
  return io;
}

export function initSocketServer(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use(async (socket, next) => {
    try {
      const tenantId = socket.handshake.auth.tenantId || socket.handshake.query.tenantId;
      const userId = socket.handshake.auth.userId || socket.handshake.query.userId;

      if (!tenantId || !userId) {
        return next(new Error("Authentication required: tenantId and userId must be provided"));
      }

      socket.data.tenantId = tenantId;
      socket.data.userId = userId;
      socket.data.conversationId = socket.handshake.query.conversationId || null;
      next();
    } catch (err) {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`[Socket] Client connected: ${socket.id} (tenant: ${socket.data.tenantId})`);

    // Join tenant-specific room for broadcasts
    socket.join(`tenant:${socket.data.tenantId}`);

    // Handle incoming chat messages
    socket.on("chat:message", async (payload: {
      message: string;
      imageUrls?: string[];
      conversationId?: string;
    }) => {
      try {
        let conversationId = payload.conversationId || socket.data.conversationId;

        // Create conversation if needed
        if (!conversationId) {
          conversationId = await createConversation(
            socket.data.tenantId,
            socket.data.userId,
          );
          socket.data.conversationId = conversationId;
          socket.emit("conversation:created", { conversationId });
        }

        // Emit start event
        const streamEvent: StreamEvent = {
          type: "agent_switch",
          data: { from: null, to: "intent_classifier" },
          conversationId,
          timestamp: new Date().toISOString(),
        };
        socket.emit("stream:event", streamEvent);

        // Process through the multi-agent workflow
        const result = await processMessage(
          {
            tenantId: socket.data.tenantId,
            userId: socket.data.userId,
            conversationId,
            metadata: {},
          },
          payload.message,
          payload.imageUrls,
        );

        // Emit agent switches
        const visitedAgents = Array.from(result.agentResults.keys());
        for (const agentType of visitedAgents) {
          const agentResult = result.agentResults.get(agentType);
          if (agentResult) {
            socket.emit("stream:event", {
              type: "agent_switch",
              data: {
                from: visitedAgents[visitedAgents.indexOf(agentType) - 1] ?? null,
                to: agentType,
                metadata: agentResult.metadata,
              },
              conversationId,
              timestamp: new Date().toISOString(),
            } satisfies StreamEvent);
          }
        }

        // Emit final message
        const finalResult = result.agentResults.get(result.currentAgent);
        socket.emit("stream:event", {
          type: "message",
          data: {
            content: finalResult?.content ?? "",
            agentType: result.currentAgent,
            metadata: finalResult?.metadata ?? {},
          },
          conversationId,
          timestamp: new Date().toISOString(),
        } satisfies StreamEvent);

        // Emit done
        socket.emit("stream:event", {
          type: "done",
          data: {
            intent: result.intent,
            shouldEscalate: result.shouldEscalate,
          },
          conversationId,
          timestamp: new Date().toISOString(),
        } satisfies StreamEvent);

      } catch (error) {
        console.error("[Socket] Error processing message:", error);
        socket.emit("stream:event", {
          type: "error",
          data: { message: error instanceof Error ? error.message : "Processing failed" },
          conversationId: payload.conversationId ?? socket.data.conversationId,
          timestamp: new Date().toISOString(),
        } satisfies StreamEvent);
      }
    });

    // Handle typing indicator
    socket.on("chat:typing", (payload: { conversationId: string; isTyping: boolean }) => {
      socket.to(`tenant:${socket.data.tenantId}`).emit("chat:typing", {
        userId: socket.data.userId,
        ...payload,
      });
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  console.log("[Socket] Socket.IO server initialized");
  return io;
}
