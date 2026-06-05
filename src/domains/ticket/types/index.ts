/**
 * Ticket Domain — Types
 *
 * Full lifecycle: open → active → escalated ⇄ resolved → closed
 * Human handoff: escalated state persists until human resolves.
 * Maps to Conversation + Message in the existing Prisma schema.
 */

// ── Channel ───────────────────────────────────────────────

export type TicketChannel = "web" | "socket" | "api" | "wechat";

// ── Status & Priority ─────────────────────────────────────

export type TicketStatus =
  | "open"              // 新建，等待首条消息
  | "active"            // 活跃中
  | "pending"           // 等待客户回复
  | "escalated"         // 已转人工
  | "resolved"          // 已解决
  | "solution_retained" // 已删除但保留方案
  | "closed";           // 已关闭

export type TicketPriority = "urgent" | "high" | "normal" | "low";

export type TicketResolution =
  | "agent_resolved"           // Agent 自动解决
  | "human_resolved"           // 人工客服解决
  | "escalated_to_human"       // 转人工（未解决）
  | "closed_by_customer"       // 客户主动关闭
  | "closed_duplicate"         // 重复工单
  | "closed_unresolvable";     // 无法解决

// ── Status Transition Map ─────────────────────────────────

/** Valid source → target transitions. */
export const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open:               ["active", "closed"],
  active:             ["pending", "escalated", "resolved", "closed"],
  pending:            ["active", "closed"],
  escalated:          ["active", "resolved", "closed"],
  resolved:           ["closed", "active"],   // active = reopen
  solution_retained:  [],
  closed:             ["active"],             // reopen
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open:               "待处理",
  active:             "处理中",
  pending:            "等待回复",
  escalated:          "已转人工",
  resolved:           "已解决",
  solution_retained:  "已清理",
  closed:             "已关闭",
};

// ── Core Entities ─────────────────────────────────────────

export interface Ticket {
  id: string;
  tenantId: string;
  userId: string;
  intent: string | null;
  subIntent: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  channel: TicketChannel;
  title: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  lastAgentType: string | null;
  resolution: TicketResolution | null;
  metadata: Record<string, unknown>;
  escalationHistory: EscalationRecord[];
  linkedOrderCount: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  role: MessageRole;
  agentType: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export type MessageRole = "user" | "assistant" | "system" | "agent";

// ── Escalation ────────────────────────────────────────────

export interface EscalationRecord {
  id: string;
  escalatedAt: Date;
  reason: string;
  escalatedBy: string;           // Agent 类型 or "system"
  priority: TicketPriority;
  resolvedAt: Date | null;
  resolvedBy: string | null;     // 人工客服 ID
  resolution: string | null;      // 人工解决方案描述
  resolutionType: TicketResolution | null;
  notes: string | null;
}

// ── Create / Update ───────────────────────────────────────

export interface CreateTicketInput {
  tenantId: string;
  userId: string;
  channel?: TicketChannel;
  priority?: TicketPriority;
  title?: string;
  metadata?: Record<string, unknown>;
  orderId?: string;              // 创建时关联订单
}

export interface UpdateTicketInput {
  title?: string;
  priority?: TicketPriority;
  metadata?: Record<string, unknown>;
}

export interface AddMessageInput {
  ticketId: string;
  role: MessageRole;
  agentType?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

// ── Escalation / Handoff ──────────────────────────────────

export interface EscalateTicketInput {
  ticketId: string;
  reason: string;
  escalatedBy: string;
  priority?: TicketPriority;
}

export interface ResolveEscalationInput {
  ticketId: string;
  escalationId: string;
  resolvedBy: string;
  resolution: string;
  resolutionType: TicketResolution;
  reopen?: boolean;              // true → back to active for agent follow-up
}

// ── Search ────────────────────────────────────────────────

export interface TicketSearchParams {
  tenantId: string;
  userId?: string;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  intent?: string;
  escalatedOnly?: boolean;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
  sortBy?: "createdAt" | "updatedAt" | "priority";
  sortDir?: "asc" | "desc";
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ── Stats ─────────────────────────────────────────────────

export interface TicketStats {
  total: number;
  byStatus: Partial<Record<TicketStatus, number>>;
  byPriority: Partial<Record<TicketPriority, number>>;
  escalatedCount: number;
  resolutionRate: number;
  avgMessagesPerTicket: number;
}
