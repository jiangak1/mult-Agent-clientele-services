/**
 * Case Ranker — Quality-aware re-ranking of matched cases.
 *
 * Factors:
 *   1. successRate:       cases with higher success rate rank higher
 *   2. satisfactionScore: cases with higher satisfaction rank higher
 *   3. resolutionCount:   more frequently used cases get a small boost
 *   4. freshness:         recently updated cases rank higher (time decay)
 *
 * Formula:
 *   finalScore = w1 × matchScore
 *              + w2 × qualityScore
 *              + w3 × freshnessScore
 *
 *   qualityScore  = 0.5 × successRate + 0.5 × (satisfactionScore / 5.0)
 *   freshnessScore = e^(-λ × daysSinceUpdate)
 */

import type { CaseMatchResult } from "../types";

// ── Config ────────────────────────────────────────────────

export interface RankerConfig {
  weights: { match: number; quality: number; freshness: number };
  timeDecay: { lambda: number; halfLifeDays: number };
}

const DEFAULT_CONFIG: RankerConfig = {
  weights: { match: 0.55, quality: 0.30, freshness: 0.15 },
  timeDecay: { lambda: 0.01, halfLifeDays: 69 },
};

// ── Ranker ───────────────────────────────────────────────

export const CaseRanker = {
  /**
   * Re-rank matched results by incorporating quality + freshness signals.
   */
  rank(results: CaseMatchResult[], config: Partial<RankerConfig> = {}): CaseMatchResult[] {
    const cfg = { ...DEFAULT_CONFIG, ...config, weights: { ...DEFAULT_CONFIG.weights, ...config.weights }, timeDecay: { ...DEFAULT_CONFIG.timeDecay, ...config.timeDecay } };
    const now = Date.now();

    const ranked = results.map((r) => {
      const qualityScore = CaseRanker.computeQualityScore(r);
      const freshnessScore = CaseRanker.computeFreshnessScore(r, now, cfg);
      const severityBoost = CaseRanker.computeSeverityBoost(r);

      const finalScore =
        cfg.weights.match * r.score +
        cfg.weights.quality * qualityScore +
        cfg.weights.freshness * freshnessScore;

      const boostedScore = Math.min(finalScore * severityBoost, 1.0);

      return {
        ...r,
        score: Math.round(boostedScore * 100) / 100,
        matchDetails: {
          ...r.matchDetails,
          qualityBoost: Math.round(qualityScore * 100) / 100,
          finalScore: Math.round(boostedScore * 100) / 100,
        },
      };
    });

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  },

  // ── Scoring Functions ──────────────────────────────────

  computeQualityScore(result: CaseMatchResult): number {
    const c = result.case;

    // If no feedback yet, give neutral score
    if (c.feedbackCount === 0) return 0.5;

    const successComponent = c.successRate;                              // 0.0 - 1.0
    const satisfactionComponent = c.satisfactionScore / 5.0;            // normalize to 0.0 - 1.0

    // Blend: slightly more weight on satisfaction
    return successComponent * 0.4 + satisfactionComponent * 0.6;
  },

  computeFreshnessScore(result: CaseMatchResult, now: number, cfg: RankerConfig): number {
    const ageDays = (now - result.case.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp(-cfg.timeDecay.lambda * ageDays);
  },

  computeSeverityBoost(result: CaseMatchResult): number {
    switch (result.case.severity) {
      case "critical": return 1.3;
      case "high":     return 1.2;
      case "medium":   return 1.0;
      case "low":      return 0.8;
      default:         return 1.0;
    }
  },

  // ── Utility ────────────────────────────────────────────

  /**
   * Deduplicate and ensure diversity: keep at most 1 per category in top results.
   */
  diversify(results: CaseMatchResult[], minUniqueCategories = 2): CaseMatchResult[] {
    const seen = new Set<string>();
    const diverse: CaseMatchResult[] = [];
    const rest: CaseMatchResult[] = [];

    for (const r of results) {
      const cat = r.case.category ?? "__none__";
      if (!seen.has(cat)) {
        seen.add(cat);
        diverse.push(r);
      } else {
        rest.push(r);
      }
    }

    // Ensure minimum unique categories
    if (seen.size < minUniqueCategories) {
      for (const r of rest) {
        const cat = r.case.category ?? "__none__";
        if (!seen.has(cat)) {
          seen.add(cat);
          diverse.push(r);
          if (seen.size >= minUniqueCategories) break;
        }
      }
    }

    // Fill remaining with rest
    diverse.push(...rest.slice(0, Math.max(0, 5 - diverse.length)));

    return diverse;
  },
};
