/**
 * Extraction Evaluator — LLM-powered issue/solution extraction from closed tickets.
 *
 * Takes a closed ticket's message history and:
 *   1. Extracts the customer's core problem (issue)
 *   2. Extracts the resolution (solution)
 *   3. Evaluates extraction quality (confidence + completeness)
 */

import { LLMService } from "@/lib/services/llm-service";
import type { TicketMessage } from "@/domains/ticket";

// ── Types ────────────────────────────────────────────────

export interface ExtractionResult {
  issue: string;
  solution: string;
  category: string | null;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;        // 0.0 - 1.0
  isComplete: boolean;        // issue + solution both present
  qualityScore: number;       // 0.0 - 1.0 (overall quality for case creation)
  resolutionType: string | null;
  tags: string[];
  reasoning: string;
}

interface ExtractionInput {
  ticketId: string;
  intent: string | null;
  resolution: string | null;
  messages: Pick<TicketMessage, "role" | "content" | "agentType">[];
}

// ── System Prompt ────────────────────────────────────────

const EXTRACTION_PROMPT = `你是一个客服知识管理专家。分析下面的客服对话，提取关键信息。

## 任务
1. 提取客户的核心问题（issue）— 用简洁的一句话描述
2. 提取解决方案（solution）— 客服如何解决的？结果如何？
3. 判断分类（category）— defect/return/refund/logistics/complaint/tech_support/other
4. 评估严重度（severity）— low/medium/high/critical
5. 对提取质量打分（confidence 0.0-1.0）

## 质量评估规则
- issue 和 solution 都清晰 → confidence ≥ 0.8
- 仅有 issue 无 solution → confidence < 0.5, isComplete=false
- 仅有 greeting/闲聊 → confidence < 0.3
- 客户确认已解决 → qualityScore +0.2
- 涉及退款/换货/投诉 → severity 至少 medium
- Agent 类型是 supervisor/escalated → severity 至少 high

## 输出格式（仅 JSON）
{
  "issue": "客户的核心问题（一句话）",
  "solution": "解决方案（一句话）",
  "category": "defect",
  "severity": "medium",
  "confidence": 0.85,
  "isComplete": true,
  "qualityScore": 0.8,
  "resolutionType": "replacement",
  "tags": ["screen", "defect", "7days"],
  "reasoning": "对话中客服明确给出了换新方案，客户表示满意"
}`;

// ── Evaluator ────────────────────────────────────────────

export const ExtractionEvaluator = {
  /**
   * Analyze a closed ticket and extract issue + solution.
   */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    // Build conversation summary
    const conversationText = buildConversationText(input.messages);

    // Quick pre-check: skip if no meaningful content
    if (input.messages.length < 2) {
      return emptyResult("对话消息不足，无法提取");
    }

    const userPrompt = [
      `【工单 ID】${input.ticketId}`,
      `【意图分类】${input.intent ?? "未知"}`,
      `【当前状态】${input.resolution ? `已解决 (${input.resolution})` : "已关闭"}`,
      "",
      "【对话记录】",
      conversationText,
      "",
      "请分析以上对话，提取 issue 和 solution。",
    ].join("\n");

    try {
      const response = await LLMService.complete(EXTRACTION_PROMPT, userPrompt, {
        temperature: 0.2,
        maxTokens: 1024,
        jsonOutput: true,
      });

      return parseResult(response, input);
    } catch {
      return fallbackExtraction(input);
    }
  },

  /**
   * Batch extract from multiple tickets.
   */
  async extractBatch(inputs: ExtractionInput[]): Promise<ExtractionResult[]> {
    const results: ExtractionResult[] = [];
    for (const input of inputs) {
      const result = await ExtractionEvaluator.extract(input);
      results.push(result);
    }
    return results;
  },

  /**
   * Determine if extraction is good enough for auto-creation or needs human review.
   */
  reviewDecision(result: ExtractionResult): "auto_approve" | "needs_review" | "reject" {
    if (!result.isComplete) return "reject";
    if (result.confidence < 0.5) return "reject";
    if (result.qualityScore >= 0.8 && result.confidence >= 0.85) return "auto_approve";
    return "needs_review";
  },
};

// ── Helpers ───────────────────────────────────────────────

function buildConversationText(
  messages: Pick<TicketMessage, "role" | "content" | "agentType">[],
): string {
  // Take last 20 messages, truncate long ones
  const recent = messages.slice(-20);
  return recent
    .map((m) => {
      const role = m.role === "user" ? "客户" : m.agentType ? `客服(${m.agentType})` : "客服";
      const content = m.content.length > 300 ? m.content.slice(0, 300) + "..." : m.content;
      return `[${role}] ${content}`;
    })
    .join("\n");
}

function parseResult(raw: string, input: ExtractionInput): ExtractionResult {
  try {
    const parsed = JSON.parse(raw);
    return {
      issue: String(parsed.issue ?? "").slice(0, 500),
      solution: String(parsed.solution ?? "").slice(0, 1000),
      category: parsed.category ?? input.intent ?? null,
      severity: validateSeverity(parsed.severity),
      confidence: clamp(Number(parsed.confidence) || 0.5, 0, 1),
      isComplete: Boolean(parsed.isComplete),
      qualityScore: clamp(Number(parsed.qualityScore) || 0.5, 0, 1),
      resolutionType: parsed.resolutionType ?? null,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10) : [],
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return fallbackExtraction(input);
  }
}

function fallbackExtraction(input: ExtractionInput): ExtractionResult {
  // Use intent + last user message as issue, resolution as solution
  const lastUserMsg = [...input.messages].reverse().find((m) => m.role === "user");
  const lastAssistantMsg = [...input.messages].reverse().find((m) => m.role === "assistant");

  return {
    issue: lastUserMsg?.content?.slice(0, 500) ?? "未知问题",
    solution: input.resolution ?? lastAssistantMsg?.content?.slice(0, 1000) ?? "未知方案",
    category: input.intent ?? null,
    severity: "medium",
    confidence: input.resolution ? 0.6 : 0.3,
    isComplete: !!(lastUserMsg && input.resolution),
    qualityScore: input.resolution ? 0.5 : 0.2,
    resolutionType: null,
    tags: [],
    reasoning: "LLM 提取失败，使用规则兜底",
  };
}

function emptyResult(reason: string): ExtractionResult {
  return {
    issue: "",
    solution: "",
    category: null,
    severity: "low",
    confidence: 0,
    isComplete: false,
    qualityScore: 0,
    resolutionType: null,
    tags: [],
    reasoning: reason,
  };
}

function validateSeverity(s: unknown): ExtractionResult["severity"] {
  if (s === "low" || s === "medium" || s === "high" || s === "critical") return s;
  return "medium";
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
