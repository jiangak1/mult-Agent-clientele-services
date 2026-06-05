/**
 * Ticket Service — Full lifecycle management.
 *
 * State machine:  open → active → escalated ⇄ resolved → closed
 * Human handoff:  escalate() → resolveEscalation()
 *
 * Delegates to existing createConversation / processMessage
 * for Agent Pipeline compatibility. Does NOT break existing flow.
 */

import { TicketRepository } from "../repositories/ticket-repository";
import { createConversation } from "@/lib/workflows/graph";
import { OrderService } from "@/domains/order";
import type {
  Ticket,
  TicketMessage,
  TicketStatus,
  TicketPriority,
  TicketResolution,
  EscalationRecord,
  TicketSearchParams,
  CreateTicketInput,
  UpdateTicketInput,
  AddMessageInput,
  EscalateTicketInput,
  ResolveEscalationInput,
  PaginatedResult,
  TicketStats,
} from "../types";
import type { UnifiedOrder } from "@/domains/order";

export const TicketService = {
  // ============================================================
  // LIFECYCLE — Create
  // ============================================================

  /** Create a new ticket. */
  async create(input: CreateTicketInput): Promise<Ticket> {
    return TicketRepository.create(input);
  },

  /** Create via existing Agent workflow (backward compat). Returns ticket ID. */
  async createFromWorkflow(
    tenantId: string,
    userId: string,
    channel = "web",
  ): Promise<string> {
    return createConversation(tenantId, userId, channel);
  },

  /** Get or create a ticket. Idempotent. */
  async getOrCreate(
    tenantId: string,
    userId: string,
    ticketId?: string | null,
  ): Promise<string> {
    if (ticketId) {
      const existing = await TicketRepository.findById(tenantId, ticketId);
      if (existing) return ticketId;
    }
    const ticket = await TicketRepository.create({
      tenantId,
      userId,
      channel: "web",
    });
    return ticket.id;
  },

  // ============================================================
  // LIFECYCLE — Read
  // ============================================================

  async get(tenantId: string, ticketId: string): Promise<Ticket | null> {
    return TicketRepository.findById(tenantId, ticketId);
  },

  async getByUser(tenantId: string, userId: string, limit?: number): Promise<Ticket[]> {
    return TicketRepository.findByUserId(tenantId, userId, limit);
  },

  async search(params: TicketSearchParams): Promise<PaginatedResult<Ticket>> {
    const { rows, total } = await TicketRepository.search(params);
    return {
      items: rows.map((r) => ({
        id: r.id as string,
        tenantId: r.tenantId as string,
        userId: r.userId as string,
        intent: (r.intent as string) ?? null,
        subIntent: (r.subIntent as string) ?? null,
        status: (r.status as TicketStatus) ?? "open",
        priority: (((r.metadata as Record<string, unknown>)?.priority) as TicketPriority) ?? "normal",
        channel: (r.channel as Ticket["channel"]) ?? "web",
        title: (((r.metadata as Record<string, unknown>)?.title) as string) ?? null,
        messageCount: (r.messageCount as number) ?? 0,
        lastMessagePreview: (r.lastMsg as { content?: string })?.content?.slice(0, 80) ?? null,
        lastAgentType: (r.lastMsg as { agentType?: string })?.agentType ?? null,
        resolution: (((r.metadata as Record<string, unknown>)?.resolution) as TicketResolution) ?? null,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        escalationHistory: (((r.metadata as Record<string, unknown>)?.escalations) as EscalationRecord[]) ?? [],
        linkedOrderCount: ((r._count as { orderLinks?: number })?.orderLinks) ?? 0,
        createdAt: r.createdAt as Date,
        updatedAt: r.updatedAt as Date,
        closedAt: (r.closedAt as Date) ?? null,
      })),
      total,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      hasMore: (params.page ?? 1) * (params.pageSize ?? 20) < total,
    };
  },

  /** List all escalated tickets (human handoff queue). */
  async getEscalatedQueue(tenantId: string, limit?: number): Promise<Ticket[]> {
    return TicketRepository.findEscalated(tenantId, limit);
  },

  // ============================================================
  // LIFECYCLE — Update
  // ============================================================

  async update(
    tenantId: string,
    ticketId: string,
    input: UpdateTicketInput,
  ): Promise<Ticket | null> {
    return TicketRepository.update(ticketId, tenantId, input);
  },

  async updateIntent(
    tenantId: string,
    ticketId: string,
    intent: string,
    subIntent?: string,
  ): Promise<void> {
    return TicketRepository.updateIntent(ticketId, tenantId, intent, subIntent);
  },

  // ============================================================
  // LIFECYCLE — Status Transitions
  // ============================================================

  /** Resolve → close (after verification). */
  async close(
    tenantId: string,
    ticketId: string,
    resolution?: TicketResolution,
  ): Promise<boolean> {
    return TicketRepository.close(tenantId, ticketId, resolution);
  },

  /** Reopen a closed ticket. */
  async reopen(tenantId: string, ticketId: string): Promise<boolean> {
    return TicketRepository.transitionStatus(ticketId, tenantId, "closed", "active");
  },

  /** Soft-delete: remove messages, optionally keep solution. */
  async softDelete(
    tenantId: string,
    ticketId: string,
    keepSolution = false,
  ): Promise<boolean> {
    return TicketRepository.softDelete(ticketId, tenantId, keepSolution);
  },

  // ============================================================
  // HUMAN HANDOFF — Escalation
  // ============================================================

  /**
   * Escalate ticket to human support.
   *
   * Called by SupervisorAgent when shouldEscalate = true.
   * Transitions ticket to "escalated" and records reason.
   */
  async escalate(input: EscalateTicketInput): Promise<EscalationRecord | null> {
    const ticket = await TicketRepository.findById("", input.ticketId);
    if (!ticket) return null;

    // Guard: only active / pending can be escalated
    if (ticket.status !== "active" && ticket.status !== "pending" && ticket.status !== "open") {
      console.warn(`[TicketService] Cannot escalate ticket in status: ${ticket.status}`);
      return null;
    }

    const ok = await TicketRepository.transitionStatus(
      input.ticketId, ticket.tenantId,
      ticket.status, "escalated",
    );

    if (!ok) return null;

    return TicketRepository.addEscalation(
      input.ticketId, ticket.tenantId,
      input,
    );
  },

  /**
   * Resolve an escalation.
   *
   * Called when a human agent resolves the escalated case.
   * Can either close the ticket or send it back to the agent for follow-up.
   */
  async resolveEscalation(input: ResolveEscalationInput): Promise<boolean> {
    const ticket = await TicketRepository.findById("", input.ticketId);
    if (!ticket || ticket.status !== "escalated") return false;

    return TicketRepository.resolveEscalation(
      input.ticketId,
      ticket.tenantId,
      input,
    );
  },

  // ============================================================
  // MESSAGES
  // ============================================================

  async getMessages(ticketId: string, limit?: number): Promise<TicketMessage[]> {
    return TicketRepository.getMessages(ticketId, limit);
  },

  /** Add a message and auto-transition open→active on first user message. */
  async addMessage(input: AddMessageInput): Promise<TicketMessage> {
    const msg = await TicketRepository.addMessage(input);

    // Auto-transition: open → active on first user message
    if (input.role === "user") {
      const ticket = await TicketRepository.findById("", input.ticketId);
      if (ticket && ticket.status === "open") {
        await TicketRepository.transitionStatus(
          input.ticketId, ticket.tenantId,
          "open", "active",
        );
      }
    }

    return msg;
  },

  // ============================================================
  // ORDER INTEGRATION
  // ============================================================

  async linkOrder(ticketId: string, orderId: string): Promise<void> {
    await OrderService.linkToConversation(ticketId, orderId);
  },

  async getLinkedOrders(ticketId: string): Promise<UnifiedOrder[]> {
    return OrderService.getOrdersForConversation(ticketId);
  },

  // ============================================================
  // STATS
  // ============================================================

  async getStats(tenantId: string): Promise<TicketStats> {
    const stats = await TicketRepository.getStats(tenantId);

    const resolvedCount = (stats.byStatus["resolved"] ?? 0) + (stats.byStatus["closed"] ?? 0);
    const total = stats.total || 1; // avoid div-by-zero

    return {
      total: stats.total,
      byStatus: stats.byStatus,
      byPriority: stats.byPriority,
      escalatedCount: stats.escalatedCount,
      resolutionRate: total > 0 ? resolvedCount / total : 0,
      avgMessagesPerTicket: 0, // would need message count join
    };
  },

  /** Convenience: check if a ticket needs human attention. */
  async needsHumanAttention(ticketId: string): Promise<boolean> {
    const ticket = await TicketRepository.findById("", ticketId);
    return ticket?.status === "escalated";
  },
};
