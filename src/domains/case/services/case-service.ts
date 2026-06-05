/**
 * Case Engine Service — Central orchestrator.
 *
 * Coordinates CaseRepository + CaseMatcher + CaseRanker + embedding provider.
 * All case operations MUST go through this service.
 */

import { CaseRepository } from "../repositories/case-repository";
import { CaseMatcher } from "./case-matcher";
import { CaseRanker } from "./case-ranker";
import { createEmbedding } from "@/lib/vector-store/milvus-client";
import type {
  CaseRecord,
  CaseSearchParams,
  CaseMatchResult,
  CreateCaseInput,
  UpdateCaseInput,
  RecordFeedbackInput,
  EmbeddingProvider,
  PaginatedResult,
} from "../types";

// ── Embedding Provider (delegates to existing createEmbedding) ──

const embedProvider: EmbeddingProvider = {
  async embed(text: string): Promise<number[]> {
    return createEmbedding(text);
  },
  async embedBatch(texts: string[]): Promise<number[][]> {
    const { createEmbeddings } = await import("@/lib/vector-store/milvus-client");
    return createEmbeddings(texts);
  },
};

// ── Service ───────────────────────────────────────────────

export const CaseService = {
  // ==========================================================
  // CRUD
  // ==========================================================

  async getCase(tenantId: string, caseId: string): Promise<CaseRecord | null> {
    return CaseRepository.findById(tenantId, caseId);
  },

  async createCase(input: CreateCaseInput): Promise<CaseRecord> {
    const embedText = CaseMatcher.buildEmbeddingText(input.issue, input.solution);
    const embedding = await embedProvider.embed(embedText);
    return CaseRepository.create(input, embedding);
  },

  async updateCase(
    tenantId: string,
    caseId: string,
    input: UpdateCaseInput,
  ): Promise<boolean> {
    // Recompute embedding if solution changed
    let embedding: number[] | undefined;
    if (input.solution) {
      const existing = await CaseRepository.findById(tenantId, caseId);
      const issue = existing?.issue ?? "";
      const embedText = CaseMatcher.buildEmbeddingText(issue, input.solution);
      embedding = await embedProvider.embed(embedText);
    }
    return CaseRepository.update(tenantId, caseId, input, embedding);
  },

  async listCases(
    tenantId: string,
    options?: { category?: string; status?: string; productId?: string; page?: number; pageSize?: number },
  ): Promise<PaginatedResult<CaseRecord>> {
    const { rows, total } = await CaseRepository.list(tenantId, {
      ...options,
      status: options?.status as CaseRecord["status"] | undefined,
    });
    return {
      items: rows,
      total,
      page: options?.page ?? 1,
      pageSize: options?.pageSize ?? 20,
      hasMore: (options?.page ?? 1) * (options?.pageSize ?? 20) < total,
    };
  },

  // ==========================================================
  // SEARCH — Matcher + Ranker
  // ==========================================================

  async searchSimilar(params: CaseSearchParams): Promise<CaseMatchResult[]> {
    const embedText = CaseMatcher.buildEmbeddingText(params.query, "");
    const embedding = await embedProvider.embed(embedText);

    // Step 1: Match
    const matched = await CaseMatcher.match(params, embedding, embedProvider);

    // Step 2: Rank (quality + freshness)
    const ranked = CaseRanker.rank(matched);

    // Step 3: Diversify
    return CaseRanker.diversify(ranked);
  },

  // ==========================================================
  // FEEDBACK — Close the loop
  // ==========================================================

  async recordFeedback(
    tenantId: string,
    caseId: string,
    input: RecordFeedbackInput,
  ): Promise<boolean> {
    if (input.rating < 1 || input.rating > 5) {
      throw new Error("Rating must be 1-5");
    }
    return CaseRepository.recordFeedback(tenantId, caseId, input.rating, input.isResolved);
  },

  // ==========================================================
  // EMBEDDING — Management
  // ==========================================================

  /** Recompute embedding for a case (e.g., after editing issue/solution). */
  async recomputeEmbedding(tenantId: string, caseId: string): Promise<boolean> {
    const existing = await CaseRepository.findById(tenantId, caseId);
    if (!existing) return false;

    const embedText = CaseMatcher.buildEmbeddingText(existing.issue, existing.solution);
    const embedding = await embedProvider.embed(embedText);
    await CaseRepository.updateEmbedding(caseId, embedding);
    return true;
  },

  /** Batch recompute embeddings (e.g., after model upgrade). */
  async batchRecomputeEmbeddings(tenantId: string, batchSize = 50): Promise<number> {
    const { rows } = await CaseRepository.list(tenantId, { pageSize: 1000 });
    let count = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const embedTexts = batch.map((c) => CaseMatcher.buildEmbeddingText(c.issue, c.solution));
      const embeddings = await embedProvider.embedBatch(embedTexts);

      for (let j = 0; j < batch.length; j++) {
        await CaseRepository.updateEmbedding(batch[j].id, embeddings[j]);
        count++;
      }
    }

    return count;
  },
};
