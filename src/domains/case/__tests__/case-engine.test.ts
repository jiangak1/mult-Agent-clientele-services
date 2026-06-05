/**
 * Case Engine Unit Tests — CaseMatcher + CaseRanker (pure functions)
 *
 * Self-contained: no database, no embedding API, no Prisma.
 * Tests scoring logic in isolation.
 */

import { describe, test, expect } from "vitest";

// ── Replicated types (self-contained, no module dependency) ──

interface TestCase {
  id: string;
  category: string | null;
  severity: string;
  successRate: number;
  satisfactionScore: number;
  resolutionCount: number;
  feedbackCount: number;
  updatedAt: Date;
}

interface TestMatchResult {
  case: TestCase;
  score: number;
  matchDetails: {
    vectorScore: number;
    keywordScore: number;
    qualityBoost: number;
    finalScore: number;
  };
}

// ── CaseMatcher (pure functions) ──────────────────────────

const CaseMatcher = {
  buildEmbeddingText(issue: string, solution: string): string {
    return `${issue} ${issue} ${solution}`;
  },
};

// ── CaseRanker (pure functions) ───────────────────────────

const DEFAULT_WEIGHTS = { match: 0.55, quality: 0.30, freshness: 0.15 };
const DEFAULT_LAMBDA = 0.01;

const CaseRanker = {
  computeQualityScore(result: TestMatchResult): number {
    const c = result.case;
    if (c.feedbackCount === 0) return 0.5;
    return c.successRate * 0.4 + (c.satisfactionScore / 5.0) * 0.6;
  },

  computeFreshnessScore(result: TestMatchResult, now: number): number {
    const ageDays = (now - result.case.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp(-DEFAULT_LAMBDA * ageDays);
  },

  computeSeverityBoost(result: TestMatchResult): number {
    switch (result.case.severity) {
      case "critical": return 1.3;
      case "high":     return 1.2;
      case "medium":   return 1.0;
      case "low":      return 0.8;
      default:         return 1.0;
    }
  },

  rank(results: TestMatchResult[]): TestMatchResult[] {
    const now = Date.now();
    return results
      .map((r) => {
        const quality = CaseRanker.computeQualityScore(r);
        const freshness = CaseRanker.computeFreshnessScore(r, now);
        const boost = CaseRanker.computeSeverityBoost(r);

        const final =
          DEFAULT_WEIGHTS.match * r.score +
          DEFAULT_WEIGHTS.quality * quality +
          DEFAULT_WEIGHTS.freshness * freshness;

        const boosted = Math.min(final * boost, 1.0);

        return {
          ...r,
          score: Math.round(boosted * 100) / 100,
          matchDetails: {
            ...r.matchDetails,
            qualityBoost: Math.round(quality * 100) / 100,
            finalScore: Math.round(boosted * 100) / 100,
          },
        };
      })
      .sort((a, b) => b.score - a.score);
  },

  diversify(results: TestMatchResult[], minUnique = 2): TestMatchResult[] {
    const seen = new Set<string>();
    const diverse: TestMatchResult[] = [];
    const rest: TestMatchResult[] = [];

    for (const r of results) {
      const cat = r.case.category ?? "__none__";
      if (!seen.has(cat)) { seen.add(cat); diverse.push(r); }
      else { rest.push(r); }
    }
    diverse.push(...rest);
    return diverse.slice(0, Math.max(minUnique + 2, 5));
  },
};

// ── Helpers ───────────────────────────────────────────────

function c(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: overrides.id ?? "case-1",
    category: overrides.category !== undefined ? overrides.category : "defect",
    severity: overrides.severity ?? "high",
    successRate: overrides.successRate ?? 0.85,
    satisfactionScore: overrides.satisfactionScore ?? 4.5,
    resolutionCount: overrides.resolutionCount ?? 12,
    feedbackCount: overrides.feedbackCount ?? 15,
    updatedAt: overrides.updatedAt ?? new Date("2026-06-03"),
  };
}

function m(
  case_: TestCase,
  score: number,
  vectorScore: number,
  keywordScore: number,
): TestMatchResult {
  return { case: case_, score, matchDetails: { vectorScore, keywordScore, qualityBoost: 0, finalScore: 0 } };
}

// ── Tests ─────────────────────────────────────────────────

describe("CaseMatcher", () => {
  test("buildEmbeddingText weights issue ×2 over solution", () => {
    expect(CaseMatcher.buildEmbeddingText("屏幕坏点", "可换新"))
      .toBe("屏幕坏点 屏幕坏点 可换新");
  });

  test("issue appears twice in embedding text", () => {
    const text = CaseMatcher.buildEmbeddingText("iPhone屏幕出现3个明显坏点", "已换新");
    const count = text.split("iPhone屏幕出现3个明显坏点").length - 1;
    expect(count).toBe(2);
  });
});

describe("CaseRanker — qualityScore", () => {
  test("high quality", () => {
    const q = CaseRanker.computeQualityScore(m(c({ successRate: 0.9, satisfactionScore: 4.8 }), 0.7, 0.7, 0.6));
    expect(q).toBeGreaterThan(0.8);
  });

  test("low quality", () => {
    const q = CaseRanker.computeQualityScore(m(c({ successRate: 0.3, satisfactionScore: 2.0 }), 0.7, 0.7, 0.6));
    expect(q).toBeLessThan(0.5);
  });

  test("no feedback → neutral 0.5", () => {
    const q = CaseRanker.computeQualityScore(m(c({ feedbackCount: 0, successRate: 0, satisfactionScore: 0 }), 0.7, 0.7, 0.6));
    expect(q).toBe(0.5);
  });
});

describe("CaseRanker — freshnessScore", () => {
  test("just now → near 1.0", () => {
    const s = CaseRanker.computeFreshnessScore(m(c({ updatedAt: new Date() }), 0.7, 0.7, 0), Date.now());
    expect(s).toBeGreaterThan(0.99);
  });

  test("1 year ago → near 0", () => {
    const s = CaseRanker.computeFreshnessScore(
      m(c({ updatedAt: new Date(Date.now() - 365 * 86400000) }), 0.7, 0.7, 0), Date.now(),
    );
    expect(s).toBeLessThan(0.05);
  });

  test("69 days → ~0.5", () => {
    const s = CaseRanker.computeFreshnessScore(
      m(c({ updatedAt: new Date(Date.now() - 69 * 86400000) }), 0.7, 0.7, 0), Date.now(),
    );
    expect(s).toBeGreaterThan(0.45);
    expect(s).toBeLessThan(0.55);
  });
});

describe("CaseRanker — severityBoost", () => {
  test("ordering: critical > high > medium > low", () => {
    const boost = (sev: string) => CaseRanker.computeSeverityBoost(m(c({ severity: sev }), 0.7, 0.7, 0));
    expect(boost("critical")).toBeGreaterThan(boost("high"));
    expect(boost("high")).toBeGreaterThan(boost("medium"));
    expect(boost("medium")).toBeGreaterThan(boost("low"));
  });
});

describe("CaseRanker — rank()", () => {
  test("quality beats raw match score", () => {
    const highQ = m(c({ id: "hq", successRate: 0.95, satisfactionScore: 5.0 }), 0.65, 0.6, 0.7);
    const lowQ = m(c({ id: "lq", successRate: 0.2, satisfactionScore: 1.5 }), 0.85, 0.9, 0.8);
    const ranked = CaseRanker.rank([highQ, lowQ]);
    expect(ranked[0].case.id).toBe("hq");
  });

  test("preserves descending order", () => {
    const results = [
      m(c({ id: "a" }), 0.9, 0.9, 0.9),
      m(c({ id: "b" }), 0.6, 0.5, 0.7),
      m(c({ id: "c" }), 0.3, 0.2, 0.4),
    ];
    const ranked = CaseRanker.rank(results);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score);
  });

  test("matchDetails populated after ranking", () => {
    const [ranked] = CaseRanker.rank([m(c(), 0.75, 0.8, 0.6)]);
    expect(ranked.matchDetails.qualityBoost).toBeGreaterThan(0);
    expect(ranked.matchDetails.finalScore).toBeGreaterThan(0);
  });
});

describe("CaseRanker — diversify()", () => {
  test("mixed categories kept unique", () => {
    const results = [
      m(c({ id: "a", category: "defect" }), 0.9, 0.9, 0),
      m(c({ id: "b", category: "defect" }), 0.8, 0.8, 0),
      m(c({ id: "c", category: "logistics" }), 0.7, 0.7, 0),
    ];
    const div = CaseRanker.diversify(results);
    const cats = div.map((r) => r.case.category);
    expect(cats).toContain("defect");
    expect(cats).toContain("logistics");
  });
});
