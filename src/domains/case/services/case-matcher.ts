/**
 * Case Matcher — Multi-strategy case matching.
 *
 * Strategies:
 *   - vector:  pgvector cosine similarity (embedding <=>)
 *   - keyword: pg_trgm similarity on issue + solution text
 *   - hybrid:  weighted fusion of vector + keyword scores
 */

import { CaseRepository } from "../repositories/case-repository";
import type { CaseMatchResult, CaseSearchParams, EmbeddingProvider } from "../types";

// ── Default weights ──────────────────────────────────────

const WEIGHTS = {
  hybrid: { vector: 0.6, keyword: 0.4 },
};

// ── Matcher ──────────────────────────────────────────────

export const CaseMatcher = {
  /**
   * Hybrid match: vector + keyword fusion.
   * Returns deduplicated, score-merged results.
   */
  async match(
    params: CaseSearchParams,
    embedding: number[],
    embedProvider: EmbeddingProvider,
  ): Promise<CaseMatchResult[]> {
    const { tenantId, query, topK = 5, minScore = 0.5, category, productId, matchMode = "hybrid" } = params;

    if (matchMode === "vector") {
      return CaseMatcher.matchByVector(tenantId, embedding, { topK, minScore, category, productId });
    }

    if (matchMode === "keyword") {
      return CaseMatcher.matchByKeyword(tenantId, query, { topK, category, productId });
    }

    // hybrid: run both and fuse
    const [vectorResults, keywordResults] = await Promise.all([
      CaseRepository.searchByVector(tenantId, embedding, topK * 2, 0.4, { category, productId }),
      CaseRepository.searchByKeyword(tenantId, query, topK * 2),
    ]);

    // Fuse: merge scores by id
    const scoreMap = new Map<string, { case: CaseMatchResult["case"]; vectorScore: number; keywordScore: number }>();

    for (const r of vectorResults) {
      scoreMap.set(r.id, {
        case: { ...r, embedding: null },
        vectorScore: r.vectorScore,
        keywordScore: 0,
      });
    }

    for (const r of keywordResults) {
      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.keywordScore = r.keywordScore;
      } else {
        scoreMap.set(r.id, {
          case: { ...r, embedding: null },
          vectorScore: 0,
          keywordScore: r.keywordScore,
        });
      }
    }

    // Compute final scores
    const results: CaseMatchResult[] = [];
    for (const [, entry] of scoreMap) {
      const finalScore =
        entry.vectorScore * WEIGHTS.hybrid.vector +
        entry.keywordScore * WEIGHTS.hybrid.keyword;

      if (finalScore < minScore) continue;

      results.push({
        case: entry.case,
        score: Math.round(finalScore * 100) / 100,
        matchDetails: {
          vectorScore: Math.round(entry.vectorScore * 100) / 100,
          keywordScore: Math.round(entry.keywordScore * 100) / 100,
          qualityBoost: 0, // filled by Ranker
          finalScore: 0,   // filled by Ranker
        },
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  },

  // ── Single-strategy shortcuts ─────────────────────────

  async matchByVector(
    tenantId: string,
    embedding: number[],
    opts: { topK: number; minScore: number; category?: string; productId?: string },
  ): Promise<CaseMatchResult[]> {
    const rows = await CaseRepository.searchByVector(
      tenantId, embedding, opts.topK, opts.minScore,
      { category: opts.category, productId: opts.productId },
    );
    return rows.map((r) => ({
      case: { ...r, embedding: null },
      score: Math.round(r.vectorScore * 100) / 100,
      matchDetails: {
        vectorScore: Math.round(r.vectorScore * 100) / 100,
        keywordScore: 0,
        qualityBoost: 0,
        finalScore: Math.round(r.vectorScore * 100) / 100,
      },
    }));
  },

  async matchByKeyword(
    tenantId: string,
    query: string,
    opts: { topK: number; category?: string; productId?: string },
  ): Promise<CaseMatchResult[]> {
    const rows = await CaseRepository.searchByKeyword(tenantId, query, opts.topK);
    return rows
      .filter((r) => !opts.category || r.category === opts.category)
      .slice(0, opts.topK)
      .map((r) => ({
        case: { ...r, embedding: null },
        score: Math.round(r.keywordScore * 100) / 100,
        matchDetails: {
          vectorScore: 0,
          keywordScore: Math.round(r.keywordScore * 100) / 100,
          qualityBoost: 0,
          finalScore: Math.round(r.keywordScore * 100) / 100,
        },
      }));
  },

  // ── Utility: build embedding text from case fields ─────

  buildEmbeddingText(issue: string, solution: string): string {
    // Repeat issue for weight, append solution
    return `${issue} ${issue} ${solution}`;
  },
};
