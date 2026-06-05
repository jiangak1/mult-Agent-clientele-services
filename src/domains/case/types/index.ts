/**
 * Case Engine — Type Definitions
 *
 * PostgreSQL + pgvector backed. No Milvus dependency.
 */

// ── Core Entity ──────────────────────────────────────────

export interface CaseRecord {
  id: string;
  tenantId: string;
  productId: string | null;
  issue: string;
  solution: string;
  category: string | null;
  severity: CaseSeverity;
  status: CaseStatus;
  successRate: number;       // 0.0 - 1.0
  satisfactionScore: number; // 1.0 - 5.0
  resolutionCount: number;
  feedbackCount: number;
  embedding: number[] | null;
  ticketId: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ── Enums ────────────────────────────────────────────────

export type CaseStatus = "open" | "resolved" | "verified" | "archived";

export type CaseSeverity = "low" | "medium" | "high" | "critical";

export type ResolutionType =
  | "refund" | "replacement" | "repair" | "compensation"
  | "apology" | "information_only" | "escalated_external";

// ── Create / Update ──────────────────────────────────────

export interface CreateCaseInput {
  tenantId: string;
  productId?: string;
  issue: string;
  solution: string;
  category?: string;
  severity?: CaseSeverity;
  ticketId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateCaseInput {
  solution?: string;
  category?: string;
  severity?: CaseSeverity;
  status?: CaseStatus;
  successRate?: number;
  satisfactionScore?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface RecordFeedbackInput {
  rating: number;            // 1-5
  isResolved: boolean;
  comment?: string;
}

// ── Match / Search ───────────────────────────────────────

export interface CaseSearchParams {
  tenantId: string;
  query: string;
  productId?: string;
  category?: string;
  severity?: CaseSeverity[];
  topK?: number;
  minScore?: number;
  matchMode?: "keyword" | "vector" | "hybrid";
}

export interface CaseMatchResult {
  case: CaseRecord;
  score: number;
  matchDetails: {
    vectorScore: number;
    keywordScore: number;
    qualityBoost: number;
    finalScore: number;
  };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ── Embedding ────────────────────────────────────────────

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
