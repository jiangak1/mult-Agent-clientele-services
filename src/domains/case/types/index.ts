/**
 * Case Domain — Types
 *
 * Represents a support case (complaint/after-sale resolution record).
 * Extends the existing ComplaintCase model.
 */

// ── Case Status ──────────────────────────────────────────

export type CaseStatus =
  | "open"
  | "investigating"
  | "resolved"
  | "pending"
  | "duplicate"
  | "verified"
  | "archived";

export type CaseSeverity = "low" | "medium" | "high" | "critical";

export type ResolutionType =
  | "refund"
  | "replacement"
  | "repair"
  | "compensation"
  | "apology"
  | "no_action"
  | "information_only"
  | "escalated_external";

// ── Core Entity ──────────────────────────────────────────

export interface SupportCase {
  id: string;
  tenantId: string;
  ticketId: string | null;
  title: string;
  description: string;
  category: string | null;
  subCategory: string | null;
  severity: CaseSeverity;
  status: CaseStatus;
  imageUrls: string[];
  assignedTo: string | null;
  duplicateOf: string | null;
  triagedAt: Date | null;
  resolvedAt: Date | null;
  verifiedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Case Outcome ─────────────────────────────────────────

export interface CaseOutcome {
  id: string;
  caseId: string;
  resolution: string;
  resolutionType: ResolutionType;
  effortMinutes: number | null;
  costAmount: number | null;
  isAutomated: boolean;
  agentType: string | null;
  createdAt: Date;
}

// ── Case Feedback ────────────────────────────────────────

export interface CaseFeedback {
  id: string;
  caseId: string;
  userId: string | null;
  rating: number; // 1-5
  nps: number | null; // 0-10
  comment: string | null;
  isResolved: boolean | null;
  createdAt: Date;
}

// ── Case Template ────────────────────────────────────────

export interface CaseTemplate {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  solution: string;
  category: string | null;
  useCount: number;
  successRate: number | null;
  avgRating: number | null;
  avgEffortMin: number | null;
  isActive: boolean;
}

// ── Case Match Result ────────────────────────────────────

export interface CaseMatchResult {
  case: SupportCase;
  score: number;
  matchDetails: {
    vectorScore: number;
    keywordScore: number;
    categoryBoost: number;
  };
  outcome: CaseOutcome | null;
  template: CaseTemplate | null;
}

// ── Search ───────────────────────────────────────────────

export interface CaseSearchParams {
  tenantId: string;
  query: string;
  category?: string;
  severity?: CaseSeverity[];
  topK?: number;
  minScore?: number;
  includeResolvedOnly?: boolean;
  matchMode?: "keyword" | "vector" | "hybrid";
}
