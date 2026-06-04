/**
 * Ticket Service — Conversation lifecycle management.
 * Delegates to existing createConversation / processMessage for Agent compat.
 */

import { TicketRepository } from "../repositories/ticket-repository";
import { createConversation } from "@/lib/workflows/graph";
import type {
  Ticket,
  TicketMessage,
  TicketSearchParams,
  CreateTicketInput,
  AddMessageInput,
} from "../types";

export const TicketService = {
  // ── Lifecycle ────────────────────────────────────────

  async create(input: CreateTicketInput): Promise<Ticket> {
    return TicketRepository.create(input);
  },

  /** Create via existing workflow (Agent-compatible). */
  async createFromWorkflow(
    tenantId: string,
    userId: string,
    channel = "web",
  ): Promise<string> {
    return createConversation(tenantId, userId, channel);
  },

  async get(tenantId: string, ticketId: string): Promise<Ticket | null> {
    return TicketRepository.findById(tenantId, ticketId);
  },

  async search(params: TicketSearchParams): Promise<Ticket[]> {
    return TicketRepository.search(params);
  },

  async close(tenantId: string, ticketId: string): Promise<void> {
    return TicketRepository.close(tenantId, ticketId);
  },

  // ── Messages ─────────────────────────────────────────

  async getMessages(ticketId: string, limit?: number): Promise<TicketMessage[]> {
    return TicketRepository.getMessages(ticketId, limit);
  },

  async addMessage(input: AddMessageInput): Promise<TicketMessage> {
    return TicketRepository.addMessage(input);
  },

  // ── Convenience ──────────────────────────────────────

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
};
