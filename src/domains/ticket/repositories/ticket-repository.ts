/**
 * Ticket Repository — Data access for Conversation + Message.
 * All queries use Prisma (no raw SQL). Escalation data stored in
 * Conversation.metadata JSON to avoid schema changes.
 */

import { prisma } from "@/lib/auth/db-client";
import { Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import type {
  Ticket,
  TicketMessage,
  TicketStatus,
  TicketPriority,
  TicketResolution,
  TicketChannel,
  EscalationRecord,
  TicketSearchParams,
  CreateTicketInput,
  UpdateTicketInput,
  AddMessageInput,
  EscalateTicketInput,
  ResolveEscalationInput,
} from "../types";
import { VALID_TRANSITIONS, STATUS_LABELS } from "../types";

// ── Row Mappers ───────────────────────────────────────────

function mapRow(r: Record<string, unknown>): Ticket {
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  const escalations = (meta.escalations as EscalationRecord[]) ?? [];
  return {
    id: r.id as string,
    tenantId: r.tenantId as string,
    userId: r.userId as string,
    intent: (r.intent as string) ?? null,
    subIntent: (r.subIntent as string) ?? null,
    status: (r.status as TicketStatus) ?? "open",
    priority: (meta.priority as TicketPriority) ?? "normal",
    channel: (r.channel as TicketChannel) ?? "web",
    title: (meta.title as string) ?? null,
    messageCount: (r._count?.messages as number) ?? (r.messageCount as number) ?? 0,
    lastMessagePreview: (r.lastMsg?.content as string)?.slice(0, 80) ?? null,
    lastAgentType: (r.lastMsg?.agentType as string) ?? null,
    resolution: (meta.resolution as TicketResolution) ?? null,
    metadata: meta,
    escalationHistory: escalations,
    linkedOrderCount: (r._count?.orderLinks as number) ?? 0,
    createdAt: r.createdAt as Date,
    updatedAt: r.updatedAt as Date,
    closedAt: (r.closedAt as Date) ?? null,
  };
}

function buildTicketInclude() {
  return {
    _count: { select: { messages: true, orderLinks: true } },
  } satisfies Prisma.ConversationInclude;
}

// ── Repository ────────────────────────────────────────────

export const TicketRepository = {
  // ── Single Ticket ──────────────────────────────────────

  async findById(tenantId: string, ticketId: string): Promise<Ticket | null> {
    const row = await prisma.conversation.findFirst({
      where: { id: ticketId, tenantId },
      include: {
        ...buildTicketInclude(),
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, agentType: true } },
      },
    });
    if (!row) return null;
    const plain: Record<string, unknown> = {
      ...row,
      lastMsg: row.messages[0] ?? null,
    };
    return mapRow(plain);
  },

  async findByUserId(tenantId: string, userId: string, limit = 20): Promise<Ticket[]> {
    const rows = await prisma.conversation.findMany({
      where: { tenantId, userId, status: { notIn: ["solution_retained"] } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        ...buildTicketInclude(),
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, agentType: true } },
      },
    });
    return rows.map((r) => mapRow({ ...r, lastMsg: r.messages[0] ?? null }));
  },

  // ── Search ─────────────────────────────────────────────

  async search(params: TicketSearchParams): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const where: Record<string, unknown> = {
      tenantId: params.tenantId,
      status: { not: "solution_retained" },
    };
    if (params.userId) where.userId = params.userId;
    if (params.status?.length) where.status = { in: params.status };
    if (params.intent) where.intent = params.intent;
    if (params.startDate || params.endDate) {
      const d: Record<string, Date> = {};
      if (params.startDate) d.gte = params.startDate;
      if (params.endDate) d.lte = params.endDate;
      where.createdAt = d;
    }

    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const sortBy = params.sortBy ?? "updatedAt";
    const sortDir = params.sortDir ?? "desc";

    const [rows, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          ...buildTicketInclude(),
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, agentType: true } },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    const plainRows = rows.map((r) => ({ ...r, lastMsg: r.messages[0] ?? null }));
    return { rows: plainRows as unknown as Record<string, unknown>[], total };
  },

  async findEscalated(tenantId: string, limit = 20): Promise<Ticket[]> {
    const rows = await prisma.conversation.findMany({
      where: { tenantId, status: "escalated" },
      orderBy: { updatedAt: "asc" },
      take: limit,
      include: {
        ...buildTicketInclude(),
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, agentType: true } },
      },
    });
    return rows.map((r) => mapRow({ ...r, lastMsg: r.messages[0] ?? null }));
  },

  // ── Create ─────────────────────────────────────────────

  async create(input: CreateTicketInput): Promise<Ticket> {
    const meta: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      priority: input.priority ?? "normal",
      escalations: [],
    };
    if (input.title) meta.title = input.title;

    const conv = await prisma.conversation.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        channel: input.channel ?? "web",
        metadata: meta,
      },
    });

    // Link order if provided
    if (input.orderId) {
      await prisma.conversationOrder.upsert({
        where: { conversationId_orderId: { conversationId: conv.id, orderId: input.orderId } },
        create: { conversationId: conv.id, orderId: input.orderId },
        update: {},
      });
    }

    return mapRow({
      ...conv,
      messageCount: 0,
      lastMsg: null,
    });
  },

  // ── Update ─────────────────────────────────────────────

  async update(ticketId: string, tenantId: string, input: UpdateTicketInput): Promise<Ticket | null> {
    const existing = await prisma.conversation.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!existing) return null;

    const meta = (existing.metadata ?? {}) as Record<string, unknown>;
    if (input.title !== undefined) meta.title = input.title;
    if (input.priority !== undefined) meta.priority = input.priority;
    if (input.metadata) Object.assign(meta, input.metadata);

    const updated = await prisma.conversation.update({
      where: { id: ticketId },
      data: { metadata: meta as object },
      include: {
        ...buildTicketInclude(),
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, agentType: true } },
      },
    });

    return mapRow({ ...updated, lastMsg: updated.messages[0] ?? null });
  },

  // ── Status Transitions ─────────────────────────────────

  async transitionStatus(
    ticketId: string,
    tenantId: string,
    from: TicketStatus,
    to: TicketStatus,
    extras?: { resolution?: TicketResolution; closedAt?: Date; metadata?: Record<string, unknown> },
  ): Promise<boolean> {
    // Guard: validate transition
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed?.includes(to)) {
      console.warn(`[TicketRepo] Invalid transition: ${from} → ${to} (allowed: ${allowed?.join(", ")})`);
      return false;
    }

    const data: Record<string, unknown> = { status: to };
    if (to === "closed" || to === "solution_retained") {
      data.closedAt = extras?.closedAt ?? new Date();
    }
    if (to === "active" && from === "closed") {
      data.closedAt = null; // reopen
    }

    // Merge resolution into metadata
    if (extras?.resolution || extras?.metadata) {
      const existing = await prisma.conversation.findUnique({ where: { id: ticketId } });
      if (existing) {
        const meta = (existing.metadata ?? {}) as Record<string, unknown>;
        if (extras.resolution) meta.resolution = extras.resolution;
        if (extras.metadata) Object.assign(meta, extras.metadata);
        data.metadata = meta;
      }
    }

    const result = await prisma.conversation.updateMany({
      where: { id: ticketId, tenantId, status: from },
      data,
    });

    return result.count > 0;
  },

  // ── Escalation ─────────────────────────────────────────

  async addEscalation(
    ticketId: string,
    tenantId: string,
    input: EscalateTicketInput,
  ): Promise<EscalationRecord | null> {
    const ticket = await prisma.conversation.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) return null;

    const meta = (ticket.metadata ?? {}) as Record<string, unknown>;
    const escalations = (meta.escalations as EscalationRecord[]) ?? [];

    const record: EscalationRecord = {
      id: nanoid(),
      escalatedAt: new Date(),
      reason: input.reason,
      escalatedBy: input.escalatedBy,
      priority: input.priority ?? (meta.priority as TicketPriority) ?? "normal",
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
      resolutionType: null,
      notes: null,
    };

    escalations.push(record);
    meta.escalations = escalations;
    meta.priority = input.priority ?? meta.priority;

    await prisma.conversation.update({
      where: { id: ticketId },
      data: { status: "escalated", metadata: meta as object },
    });

    return record;
  },

  async resolveEscalation(
    ticketId: string,
    tenantId: string,
    input: ResolveEscalationInput,
  ): Promise<boolean> {
    const ticket = await prisma.conversation.findFirst({
      where: { id: ticketId, tenantId, status: "escalated" },
    });
    if (!ticket) return false;

    const meta = (ticket.metadata ?? {}) as Record<string, unknown>;
    const escalations = (meta.escalations as EscalationRecord[]) ?? [];
    const idx = escalations.findIndex((e) => e.id === input.escalationId);
    if (idx === -1) return false;

    escalations[idx] = {
      ...escalations[idx],
      resolvedAt: new Date(),
      resolvedBy: input.resolvedBy,
      resolution: input.resolution,
      resolutionType: input.resolutionType,
    };

    meta.escalations = escalations;
    meta.resolution = input.resolutionType;

    const newStatus: TicketStatus = input.reopen ? "active" : "resolved";

    await prisma.conversation.update({
      where: { id: ticketId },
      data: {
        status: newStatus,
        metadata: meta as object,
        ...(newStatus === "resolved" ? {} : {}),
      },
    });

    return true;
  },

  // ── Close / Delete ─────────────────────────────────────

  async close(
    tenantId: string,
    ticketId: string,
    resolution?: TicketResolution,
  ): Promise<boolean> {
    return TicketRepository.transitionStatus(
      ticketId, tenantId,
      "active", "closed",
      { resolution, closedAt: new Date() },
    );
  },

  async softDelete(ticketId: string, tenantId: string, keepSolution: boolean): Promise<boolean> {
    if (keepSolution) {
      // Delete messages, keep metadata as solution record
      await prisma.message.deleteMany({ where: { conversationId: ticketId } });
      return TicketRepository.transitionStatus(
        ticketId, tenantId, "active", "solution_retained",
        { closedAt: new Date() },
      );
    }
    return TicketRepository.transitionStatus(
      ticketId, tenantId, "active", "closed",
      { closedAt: new Date() },
    );
  },

  // ── Messages ───────────────────────────────────────────

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

    // Touch the conversation updatedAt
    await prisma.conversation.update({
      where: { id: input.ticketId },
      data: { updatedAt: new Date() },
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

  // ── Stats ──────────────────────────────────────────────

  async getStats(tenantId: string): Promise<{
    total: number;
    byStatus: Partial<Record<TicketStatus, number>>;
    byPriority: Partial<Record<TicketPriority, number>>;
    escalatedCount: number;
  }> {
    const rows = await prisma.conversation.findMany({
      where: { tenantId, status: { not: "solution_retained" } },
      select: { status: true, metadata: true },
    });

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let escalatedCount = 0;

    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.status === "escalated") escalatedCount++;
      const meta = r.metadata as Record<string, unknown> | null;
      const prio = (meta?.priority as string) ?? "normal";
      byPriority[prio] = (byPriority[prio] ?? 0) + 1;
    }

    return {
      total: rows.length,
      byStatus: byStatus as Partial<Record<TicketStatus, number>>,
      byPriority: byPriority as Partial<Record<TicketPriority, number>>,
      escalatedCount,
    };
  },

  // ── Intent ─────────────────────────────────────────────

  async updateIntent(
    ticketId: string,
    tenantId: string,
    intent: string,
    subIntent?: string,
  ): Promise<void> {
    await prisma.conversation.updateMany({
      where: { id: ticketId, tenantId },
      data: { intent, subIntent: subIntent ?? null },
    });
  },
};
