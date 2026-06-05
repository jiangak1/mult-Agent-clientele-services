/**
 * Learning Pipeline Unit Tests
 *
 * Tests extraction evaluation logic and pipeline decisions.
 * No LLM/DB required — pure function tests.
 */

import { describe, test, expect } from "vitest";

// ── Self-contained ExtractionEvaluator (pure logic, no LLM) ──

const ExtractionEvaluator = {
  reviewDecision(result: TestExtraction): "auto_approve" | "needs_review" | "reject" {
    if (!result.isComplete) return "reject";
    if (result.confidence < 0.5) return "reject";
    if (result.qualityScore >= 0.8 && result.confidence >= 0.85) return "auto_approve";
    return "needs_review";
  },
};

interface TestExtraction {
  issue: string;
  solution: string;
  confidence: number;
  isComplete: boolean;
  qualityScore: number;
  category: string | null;
  severity: string;
  tags: string[];
  reasoning: string;
}

function makeExtraction(overrides: Partial<TestExtraction> = {}): TestExtraction {
  return {
    issue: "屏幕出现坏点",
    solution: "检测确认为出厂缺陷，7天内办理换新",
    confidence: overrides.confidence ?? 0.9,
    isComplete: overrides.isComplete ?? true,
    qualityScore: overrides.qualityScore ?? 0.85,
    category: overrides.category ?? "defect",
    severity: overrides.severity ?? "high",
    tags: overrides.tags ?? ["screen", "defect"],
    reasoning: overrides.reasoning ?? "完整提取",
  };
}

// ── Pipeline logic (pure) ────────────────────────────────

function buildConversationText(
  messages: { role: string; content: string; agentType?: string }[],
): string {
  return messages.slice(-20).map((m) => {
    const role = m.role === "user" ? "客户" : m.agentType ? `客服(${m.agentType})` : "客服";
    const content = m.content.length > 300 ? m.content.slice(0, 300) + "..." : m.content;
    return `[${role}] ${content}`;
  }).join("\n");
}

function parseExtractionJSON(raw: string): TestExtraction {
  try {
    const p = JSON.parse(raw);
    return {
      issue: String(p.issue ?? "").slice(0, 500),
      solution: String(p.solution ?? "").slice(0, 1000),
      confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0.5)),
      isComplete: Boolean(p.isComplete),
      qualityScore: Math.max(0, Math.min(1, Number(p.qualityScore) || 0.5)),
      category: p.category ?? null,
      severity: ["low", "medium", "high", "critical"].includes(p.severity) ? p.severity : "medium",
      tags: Array.isArray(p.tags) ? p.tags : [],
      reasoning: String(p.reasoning ?? ""),
    };
  } catch {
    return makeExtraction({ confidence: 0.3, qualityScore: 0.2, isComplete: false, reasoning: "parse error" });
  }
}

function acceptanceCriteria(extraction: TestExtraction): {
  canAutoCreate: boolean;
  needsHuman: boolean;
  shouldReject: boolean;
} {
  const decision = ExtractionEvaluator.reviewDecision(extraction);
  return {
    canAutoCreate: decision === "auto_approve",
    needsHuman: decision === "needs_review",
    shouldReject: decision === "reject",
  };
}

// ── Tests ─────────────────────────────────────────────────

describe("ExtractionEvaluator — reviewDecision", () => {
  test("high confidence + complete → auto_approve", () => {
    const e = makeExtraction({ confidence: 0.9, qualityScore: 0.85, isComplete: true });
    expect(ExtractionEvaluator.reviewDecision(e)).toBe("auto_approve");
  });

  test("medium confidence → needs_review", () => {
    const e = makeExtraction({ confidence: 0.7, qualityScore: 0.7, isComplete: true });
    expect(ExtractionEvaluator.reviewDecision(e)).toBe("needs_review");
  });

  test("incomplete → reject", () => {
    const e = makeExtraction({ isComplete: false });
    expect(ExtractionEvaluator.reviewDecision(e)).toBe("reject");
  });

  test("low confidence → reject", () => {
    const e = makeExtraction({ confidence: 0.3, isComplete: true });
    expect(ExtractionEvaluator.reviewDecision(e)).toBe("reject");
  });

  test("borderline: conf=0.84 qual=0.8 → needs_review", () => {
    const e = makeExtraction({ confidence: 0.84, qualityScore: 0.8, isComplete: true });
    expect(ExtractionEvaluator.reviewDecision(e)).toBe("needs_review");
  });

  test("borderline: conf=0.85 qual=0.79 → needs_review", () => {
    const e = makeExtraction({ confidence: 0.85, qualityScore: 0.79, isComplete: true });
    expect(ExtractionEvaluator.reviewDecision(e)).toBe("needs_review");
  });
});

describe("acceptanceCriteria", () => {
  test("good extraction → can auto-create, no review needed", () => {
    const criteria = acceptanceCriteria(makeExtraction());
    expect(criteria.canAutoCreate).toBe(true);
    expect(criteria.needsHuman).toBe(false);
    expect(criteria.shouldReject).toBe(false);
  });

  test("medium extraction → needs human review", () => {
    const criteria = acceptanceCriteria(makeExtraction({ confidence: 0.7, qualityScore: 0.6 }));
    expect(criteria.canAutoCreate).toBe(false);
    expect(criteria.needsHuman).toBe(true);
    expect(criteria.shouldReject).toBe(false);
  });

  test("bad extraction → should reject", () => {
    const criteria = acceptanceCriteria(makeExtraction({ isComplete: false }));
    expect(criteria.shouldReject).toBe(true);
  });
});

describe("buildConversationText", () => {
  test("formats messages with role labels", () => {
    const text = buildConversationText([
      { role: "user", content: "我的手机屏幕有坏点" },
      { role: "assistant", content: "非常抱歉给您带来困扰", agentType: "aftersale" },
      { role: "user", content: "可以退货吗" },
    ]);
    expect(text).toContain("[客户]");
    expect(text).toContain("[客服(aftersale)]");
    expect(text).toContain("手机屏幕");
  });

  test("truncates long messages at 300 chars", () => {
    const longMsg = "A".repeat(500);
    const text = buildConversationText([
      { role: "user", content: longMsg },
    ]);
    expect(text.length).toBeLessThan(350); // label + 300 + "..."
    expect(text).toContain("...");
  });

  test("takes last 20 messages max", () => {
    const msgs = Array.from({ length: 25 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i}`,
    }));
    const text = buildConversationText(msgs);
    expect(text).toContain("Message 5");   // first included (index 5 = msg 5)
    expect(text).not.toContain("Message 0"); // dropped
    expect(text).toContain("Message 24");   // last included
  });
});

describe("parseExtractionJSON", () => {
  test("parses valid JSON", () => {
    const result = parseExtractionJSON(JSON.stringify({
      issue: "屏幕坏点",
      solution: "换新",
      confidence: 0.88,
      isComplete: true,
      qualityScore: 0.9,
      category: "defect",
      severity: "high",
      tags: ["screen"],
      reasoning: "ok",
    }));
    expect(result.issue).toBe("屏幕坏点");
    expect(result.confidence).toBe(0.88);
    expect(result.isComplete).toBe(true);
  });

  test("clamps confidence to [0, 1]", () => {
    expect(parseExtractionJSON('{"confidence": 1.5, "isComplete": true}').confidence).toBe(1.0);
    expect(parseExtractionJSON('{"confidence": -0.5, "isComplete": true}').confidence).toBe(0.0);
  });

  test("validates severity enum", () => {
    expect(parseExtractionJSON('{"severity": "high"}').severity).toBe("high");
    expect(parseExtractionJSON('{"severity": "unknown"}').severity).toBe("medium");
  });

  test("fallback on bad JSON", () => {
    const result = parseExtractionJSON("not json");
    expect(result.isComplete).toBe(false);
    expect(result.reasoning).toBe("parse error");
  });
});

describe("Learning Pipeline — batch summary", () => {
  test("correctly categorizes batch results", () => {
    const extractions: TestExtraction[] = [
      makeExtraction({ confidence: 0.9, qualityScore: 0.85 }), // auto
      makeExtraction({ confidence: 0.7, qualityScore: 0.7 }),  // review
      makeExtraction({ isComplete: false }),                    // reject
      makeExtraction({ confidence: 0.95, qualityScore: 0.9 }),  // auto
    ];

    const decisions = extractions.map((e) => ExtractionEvaluator.reviewDecision(e));
    const autoCount = decisions.filter((d) => d === "auto_approve").length;
    const reviewCount = decisions.filter((d) => d === "needs_review").length;
    const rejectCount = decisions.filter((d) => d === "reject").length;

    expect(autoCount).toBe(2);
    expect(reviewCount).toBe(1);
    expect(rejectCount).toBe(1);
  });
});
