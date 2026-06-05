/**
 * Conversation Learning Pipeline
 *
 * Flow:  closed/resolved Tickets
 *          ↓
 *        ExtractionEvaluator.extract()  ← LLM extracts issue + solution
 *          ↓
 *        reviewDecision()               ← auto-approve / needs_review / reject
 *          ↓
 *        [Human Review]                 ← optional: review queue for low-confidence
 *          ↓
 *        CaseService.createCase()       ← persisted to Case table + embedding
 *          ↓
 *        Case Engine                    ← searchable knowledge base
 */

import { TicketRepository } from "@/domains/ticket/repositories/ticket-repository";
import { CaseService } from "./case-service";
import { ExtractionEvaluator } from "./extraction-evaluator";
import type { ExtractionResult } from "./extraction-evaluator";
import type { TicketMessage } from "@/domains/ticket";
import type { CaseRecord, CreateCaseInput } from "../types";

// ── Types ────────────────────────────────────────────────

export type ReviewDecision = "auto_approve" | "needs_review" | "reject";

export interface LearningItem {
  ticketId: string;
  extraction: ExtractionResult;
  decision: ReviewDecision;
  reviewed: boolean;
  reviewedBy: string | null;
  reviewNote: string | null;
  caseId: string | null;         // created case ID (if approved)
  processedAt: Date;
}

export interface LearningBatch {
  total: number;
  autoApproved: number;
  needsReview: number;
  rejected: number;
  created: number;
  items: LearningItem[];
}

export interface LearningOptions {
  tenantId: string;
  limit?: number;                  // max tickets to process
  minConfidence?: number;          // minimum confidence for auto-approval
  autoCreate?: boolean;            // auto-create cases for auto_approve items
  since?: Date;                    // only tickets closed after this date
}

// ── Pipeline ─────────────────────────────────────────────

export const LearningPipeline = {
  /**
   * Full pipeline: closed tickets → extraction → review → case creation.
   */
  async run(options: LearningOptions): Promise<LearningBatch> {
    const { tenantId, limit = 20, minConfidence = 0.85, autoCreate = true, since } = options;

    // Stage 1: Fetch closed/resolved tickets
    const tickets = await fetchClosableTickets(tenantId, limit, since);
    if (tickets.length === 0) {
      return { total: 0, autoApproved: 0, needsReview: 0, rejected: 0, created: 0, items: [] };
    }

    const items: LearningItem[] = [];

    // Stage 2-4: Extract → Evaluate → Create
    for (const ticket of tickets) {
      const messages = await TicketRepository.getMessages(ticket.id, 50);

      const extraction = await ExtractionEvaluator.extract({
        ticketId: ticket.id,
        intent: ticket.intent,
        resolution: ticket.resolution,
        messages,
      });

      const decision = ExtractionEvaluator.reviewDecision(extraction);

      // Override with config
      const finalDecision: ReviewDecision =
        decision === "auto_approve" && extraction.confidence < minConfidence
          ? "needs_review"
          : decision;

      let caseId: string | null = null;

      if (finalDecision === "auto_approve" && autoCreate) {
        caseId = await createCaseFromExtraction(tenantId, extraction, ticket.id, ticket.productId);
      }

      items.push({
        ticketId: ticket.id,
        extraction,
        decision: finalDecision,
        reviewed: finalDecision !== "needs_review",
        reviewedBy: finalDecision === "auto_approve" ? "system" : null,
        reviewNote: null,
        caseId,
        processedAt: new Date(),
      });
    }

    // Summarize
    return {
      total: items.length,
      autoApproved: items.filter((i) => i.decision === "auto_approve").length,
      needsReview: items.filter((i) => i.decision === "needs_review").length,
      rejected: items.filter((i) => i.decision === "reject").length,
      created: items.filter((i) => i.caseId !== null).length,
      items,
    };
  },

  /**
   * Get items pending human review.
   */
  async getPendingReviews(tenantId: string): Promise<LearningItem[]> {
    // In production: fetch from a review_queue table
    // For now: return empty (reviews are consumed inline from the batch result)
    return [];
  },

  /**
   * Human approves a reviewed item → creates case.
   */
  async approveReview(
    tenantId: string,
    ticketId: string,
    extraction: ExtractionResult,
    reviewerId: string,
    modifications?: Partial<Pick<ExtractionResult, "issue" | "solution" | "category" | "severity">>,
  ): Promise<string | null> {
    // Apply human modifications
    const final: ExtractionResult = {
      ...extraction,
      ...modifications,
      confidence: Math.max(extraction.confidence, 0.9),
      qualityScore: Math.max(extraction.qualityScore, 0.8),
    };

    // Get ticket for productId
    const ticket = await TicketRepository.findById(tenantId, ticketId);
    const productId = (ticket?.metadata?.productId as string) ?? null;

    return createCaseFromExtraction(tenantId, final, ticketId, productId);
  },
};

// ── Helpers ───────────────────────────────────────────────

interface ClosableTicket {
  id: string;
  intent: string | null;
  resolution: string | null;
  productId: string | null;
}

async function fetchClosableTickets(
  tenantId: string,
  limit: number,
  since?: Date,
): Promise<ClosableTicket[]> {
  const { rows } = await TicketRepository.search({
    tenantId,
    status: ["resolved", "closed"],
    limit,
    sortBy: "updatedAt",
    sortDir: "desc",
    ...(since ? { startDate: since } : {}),
  });

  // Filter: skip short conversations, already-processed
  return rows
    .filter((r) => {
      const msgCount = (r.messageCount as number) ?? 0;
      return msgCount >= 3; // at least 3 messages for meaningful extraction
    })
    .slice(0, limit)
    .map((r) => ({
      id: r.id as string,
      intent: (r.intent as string) ?? null,
      resolution: (((r.metadata ?? {}) as Record<string, unknown>).resolution) as string ?? null,
      productId: ((r.metadata ?? {}) as Record<string, unknown>).productId as string ?? null,
    }));
}

async function createCaseFromExtraction(
  tenantId: string,
  extraction: ExtractionResult,
  ticketId: string,
  productId: string | null,
): Promise<string | null> {
  if (!extraction.isComplete) return null;
  if (!extraction.issue || !extraction.solution) return null;

  const input: CreateCaseInput = {
    tenantId,
    productId: productId ?? undefined,
    issue: extraction.issue,
    solution: extraction.solution,
    category: extraction.category ?? undefined,
    severity: extraction.severity,
    ticketId,
    tags: extraction.tags,
    metadata: {
      source: "learning_pipeline",
      extractionConfidence: extraction.confidence,
      extractionQuality: extraction.qualityScore,
      resolutionType: extraction.resolutionType,
      reasoning: extraction.reasoning,
    },
  };

  try {
    const caseRecord = await CaseService.createCase(input);
    return caseRecord.id;
  } catch (err) {
    console.error(`[LearningPipeline] Failed to create case for ticket ${ticketId}:`, err);
    return null;
  }
}
