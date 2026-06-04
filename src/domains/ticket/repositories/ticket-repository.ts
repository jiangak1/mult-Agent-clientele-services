/**
 * Ticket Repository — Data access for Conversation + Message.
 * Wraps existing Prisma queries with tenant-aware filters.
 */

import { prisma } from "@/lib/auth/db-client";
import type {
  Ticket,
  TicketMessage,
  TicketSearchParams,
  CreateTicketInput,
  AddMessageInput,
  TicketStatus,
} from "../types";

function mapConversation(row: Record<string, unknown>): Ticket {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    userId: row.userId as string,
    intent: (row.intent as string) ?? null,
    subIntent: (row.subIntent as string) ?? null,
    status: (row.status as TicketStatus) ?? "active",
    channel: (row.channel as Ticket["channel"]) ?? "web",
    metadata: meta,
    title: (meta.title as string) ?? null,
    messageCount: (row.messageCount as number) ?? 0,
    lastMessagePreview: (row.lastMessagePreview as string) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
    closedAt: (row.closedAt as Date) ?? null,
  };
}

export const TicketRepository = {
  async findById(tenantId: string, ticketId: string): Promise<Ticket | null> {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM "Message" WHERE "conversationId" = c.id) as "messageCount",
              (SELECT "content" FROM "Message" WHERE "conversationId" = c.id ORDER BY "createdAt" DESC LIMIT 1) as "lastMessagePreview"
       FROM "Conversation" c
       WHERE c.id = $1 AND c."tenantId" = $2
       LIMIT 1`,
      ticketId,
      tenantId,
    );
    if (!rows || rows.length === 0) return null;
    return mapConversation(rows[0] as Record<string, unknown>);
  },

  async search(params: TicketSearchParams): Promise<Ticket[]> {
    const conditions: string[] = [`c."tenantId" = '${params.tenantId}'`];
    if (params.userId) conditions.push(`c."userId" = '${params.userId}'`);
    if (params.status && params.status.length > 0) {
      conditions.push(`c."status" IN (${params.status.map((s) => `'${s}'`).join(",")})`);
    }
    if (params.intent) conditions.push(`c."intent" = '${params.intent}'`);

    const where = conditions.join(" AND ");
    const limit = params.limit ?? 20;

    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM "Message" WHERE "conversationId" = c.id) as "messageCount",
              (SELECT "content" FROM "Message" WHERE "conversationId" = c.id ORDER BY "createdAt" DESC LIMIT 1) as "lastMessagePreview"
       FROM "Conversation" c
       WHERE ${where}
       ORDER BY c."updatedAt" DESC
       LIMIT ${limit}`,
    );
    return (rows as Record<string, unknown>[]).map(mapConversation);
  },

  async create(input: CreateTicketInput): Promise<Ticket> {
    const conv = await prisma.conversation.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        channel: input.channel,
        metadata: input.metadata ?? {},
      },
    });
    return {
      id: conv.id,
      tenantId: conv.tenantId,
      userId: conv.userId,
      intent: conv.intent,
      subIntent: conv.subIntent,
      status: conv.status as TicketStatus,
      channel: conv.channel as Ticket["channel"],
      metadata: conv.metadata as Record<string, unknown>,
      title: null,
      messageCount: 0,
      lastMessagePreview: null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      closedAt: conv.closedAt,
    };
  },

  async close(tenantId: string, ticketId: string): Promise<void> {
    await prisma.conversation.updateMany({
      where: { id: ticketId, tenantId },
      data: { status: "closed", closedAt: new Date() },
    });
  },

  // ── Messages ────────────────────────────────────────────

  async getMessages(ticketId: string, limit = 50): Promise<TicketMessage[]> {
    const msgs = await prisma.message.findMany({
      where: { conversationId: ticketId },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return msgs.map((m) => ({
      id: m.id,
      ticketId: m.conversationId,
      role: m.role as TicketMessage["role"],
      agentType: m.agentType,
      content: m.content,
      metadata: m.metadata as Record<string, unknown>,
      createdAt: m.createdAt,
    }));
  },

  async addMessage(input: AddMessageInput): Promise<TicketMessage> {
    const msg = await prisma.message.create({
      data: {
        conversationId: input.ticketId,
        role: input.role,
        agentType: input.agentType ?? null,
        content: input.content,
        metadata: input.metadata ?? {},
      },
    });
    return {
      id: msg.id,
      ticketId: msg.conversationId,
      role: msg.role as TicketMessage["role"],
      agentType: msg.agentType,
      content: msg.content,
      metadata: msg.metadata as Record<string, unknown>,
      createdAt: msg.createdAt,
    };
  },
};
