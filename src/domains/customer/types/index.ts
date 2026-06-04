/**
 * Customer Domain — Types
 *
 * Represents a customer entity within a tenant context.
 * Maps to CustomerUser in the existing Prisma schema.
 */

// ── Core Entity ──────────────────────────────────────────

export interface CustomerProfile {
  id: string;
  tenantId: string;
  externalId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerSearchParams {
  tenantId: string;
  email?: string;
  phone?: string;
  name?: string;
  externalId?: string;
  limit?: number;
}

// ── User Memory ──────────────────────────────────────────

export type MemoryNamespace =
  | "user_preferences"
  | "conversation_history"
  | "complaint_context"
  | "product_interest";

export interface MemoryEntry {
  key: string;
  value: unknown;
  ttl?: number;
}

export interface CustomerMemory {
  id: string;
  userId: string;
  namespace: MemoryNamespace;
  key: string;
  value: unknown;
  ttl: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Product Interest ─────────────────────────────────────

export interface ProductInterest {
  userId: string;
  productIds: string[];
  categories: string[];
  lastUpdated: string;
}

// ── Complaint Context ────────────────────────────────────

export interface ComplaintContext {
  userId: string;
  conversationId: string;
  query: string;
  imageCount: number;
  similarCasesFound: number;
  timestamp: string;
}

// ── Customer Summary (for Agent context) ──────────────────

export interface CustomerSummary {
  id: string;
  name: string;
  hasOrders: boolean;
  recentProductInterest: string[];
  activeComplaints: number;
  totalConversations: number;
  lastActiveAt: Date | null;
}
