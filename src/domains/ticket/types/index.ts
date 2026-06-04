/**
 * Ticket Domain — Types
 *
 * Represents a customer service conversation (ticket).
 * Maps to Conversation + Message in the existing Prisma schema.
 */

// ── Ticket (Conversation) ────────────────────────────────

export type TicketChannel = "web" | "socket" | "api" | "wechat";

export type TicketStatus =
  | "active"
  | "pending"
  | "resolved"
  | "escalated"
  | "solution_retained"
  | "closed";

export interface Ticket {
  id: string;
  tenantId: string;
  userId: string;
  intent: string | null;
  subIntent: string | null;
  status: TicketStatus;
  channel: TicketChannel;
  metadata: Record<string, unknown>;
  title: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

// ── Ticket Message ───────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "agent";

export interface TicketMessage {
  id: string;
  ticketId: string;
  role: MessageRole;
  agentType: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ── Search ───────────────────────────────────────────────

export interface TicketSearchParams {
  tenantId: string;
  userId?: string;
  status?: TicketStatus[];
  intent?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

// ── Create / Update ──────────────────────────────────────

export interface CreateTicketInput {
  tenantId: string;
  userId: string;
  channel: TicketChannel;
  metadata?: Record<string, unknown>;
}

export interface AddMessageInput {
  ticketId: string;
  role: MessageRole;
  agentType?: string;
  content: string;
  metadata?: Record<string, unknown>;
}
