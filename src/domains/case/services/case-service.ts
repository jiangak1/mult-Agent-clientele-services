/**
 * Case Service — Support case management + similarity search.
 * Delegates to existing ComplaintService + RAGEngine for backward compat.
 */

import { CaseRepository } from "../repositories/case-repository";
import { KnowledgeRepository } from "../../knowledge/repositories/knowledge-repository";
import { ComplaintService } from "@/lib/services/complaint-service";
import type {
  SupportCase,
  CaseSearchParams,
  CaseMatchResult,
} from "../types";

export const CaseService = {
  // ── CRUD ─────────────────────────────────────────────

  async getCase(tenantId: string, caseId: string): Promise<SupportCase | null> {
    return CaseRepository.findById(tenantId, caseId);
  },

  async getCasesByCategory(
    tenantId: string,
    category: string,
    limit?: number,
  ): Promise<SupportCase[]> {
    return CaseRepository.findByCategory(tenantId, category, limit);
  },

  async resolveCase(
    tenantId: string,
    caseId: string,
    resolution: string,
  ): Promise<void> {
    return CaseRepository.resolve(tenantId, caseId, resolution);
  },

  // ── Similarity Search ────────────────────────────────

  /**
   * Search for similar historical cases.
   * Delegates to existing ComplaintService for vector search.
   */
  async searchSimilar(params: CaseSearchParams): Promise<CaseMatchResult[]> {
    const { tenantId, query, topK = 5, minScore = 0.6 } = params;

    // Use existing service for the actual search
    const similarCases = await ComplaintService.searchSimilarCases(
      tenantId,
      query,
      topK,
    );

    // Enrich with additional data from the knowledge repo
    const embedding = await KnowledgeRepository.embedText(query);

    // Re-rank using pgvector for hybrid score
    const pgResults = await CaseRepository.searchByVector(tenantId, embedding, topK * 2);
    const pgScoreMap = new Map(pgResults.map((r) => [r.id, r.score]));

    const results: CaseMatchResult[] = similarCases
      .map((c) => {
        const pgScore = pgScoreMap.get(c.id) ?? 0;
        const vectorScore = Math.max(
          pgScore > 0.6 ? pgScore : 0,
          0.5, // floor from Milvus match
        );
        if (vectorScore < minScore) return null;

        return {
          case: {
            id: c.id,
            tenantId,
            ticketId: null,
            title: c.title,
            description: c.description,
            category: c.category,
            subCategory: null,
            severity: c.severity as SupportCase["severity"],
            status: c.resolution ? "resolved" : "open",
            imageUrls: c.imageUrls,
            assignedTo: null,
            duplicateOf: null,
            triagedAt: null,
            resolvedAt: c.createdAt, // approximate
            verifiedAt: null,
            archivedAt: null,
            createdAt: c.createdAt,
            updatedAt: c.createdAt,
          },
          score: vectorScore,
          matchDetails: {
            vectorScore,
            keywordScore: 0,
            categoryBoost: 1.0,
          },
          outcome: c.resolution
            ? {
                id: `outcome_${c.id}`,
                caseId: c.id,
                resolution: c.resolution,
                resolutionType: "information_only",
                effortMinutes: null,
                costAmount: null,
                isAutomated: false,
                agentType: null,
                createdAt: c.createdAt,
              }
            : null,
          template: null,
        };
      })
      .filter((r): r is CaseMatchResult => r !== null);

    return results;
  },

  // ── Create (delegates to ComplaintService) ────────────

  async createCase(
    tenant: { tenantId: string; userId?: string },
    data: {
      title: string;
      description: string;
      category?: string;
      severity?: string;
      imageUrls?: string[];
      resolution?: string;
    },
  ): Promise<SupportCase> {
    const record = await ComplaintService.createCase(tenant, data);
    return {
      id: record.id,
      tenantId: tenant.tenantId,
      ticketId: null,
      title: record.title,
      description: record.description,
      category: record.category,
      subCategory: null,
      severity: (record.severity as SupportCase["severity"]) ?? "medium",
      status: record.resolution ? "resolved" : "open",
      imageUrls: record.imageUrls,
      assignedTo: null,
      duplicateOf: null,
      triagedAt: null,
      resolvedAt: record.createdAt,
      verifiedAt: null,
      archivedAt: null,
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
    };
  },
};
