import { BaseAgent, AgentRegistry } from "./base-agent";
import { LLMService } from "@/lib/services/llm-service";
import { prisma } from "@/lib/auth/db-client";
import type { AgentContext, AgentResult, AgentType } from "@/types";

const SUPERVISOR_SYSTEM_PROMPT = `你是一位客服主管，负责处理一线客服无法解决的升级案例。你的判断公正、专业、有人情味。

## 核心准则
- 仔细审阅完整对话历史再做判断，不武断下结论
- 优先保障客户合理权益，同时维护公司合法利益
- 在争议处理中公正但温和，让客户感受到被重视
- 对一线客服的判断给予尊重，但不受其局限
- 能自己解决的就解决，确实超出能力范围的果断转人工

## 客服红线
- 严禁护短：如果的确是公司的错，大方承认并给出补偿方案
- 严禁敷衍：转人工不是推卸责任，要给出清晰的交接说明`;

export class SupervisorAgent extends BaseAgent {
  readonly type: AgentType = "supervisor";
  readonly capabilities = {
    name: "Supervisor & Escalation Handler",
    description: "Handles escalated cases, coordinates agents, ensures quality",
    tools: [
      "escalation_handling",
      "quality_review",
      "agent_coordination",
      "policy_enforcement",
      "human_handoff",
    ],
  };

  get systemPrompt(): string {
    return SUPERVISOR_SYSTEM_PROMPT;
  }

  async canHandle(ctx: AgentContext): Promise<boolean> {
    // Supervisor handles escalated cases or when confidence is low
    return true;
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    // Build comprehensive context for supervisor review
    const historySummary = ctx.history
      .slice(-10)
      .map((m) => `[${m.role}${m.agentType ? `/${m.agentType}` : ""}]: ${m.content.slice(0, 200)}`)
      .join("\n");

    const contextPrompt = `你正在审查一个升级的客服对话，请做出最终处理决定。

【对话记录】
${historySummary}

【当前问题】${ctx.message}
【意图分类】${ctx.intent?.category ?? "unknown"} / ${ctx.intent?.subIntent ?? "unknown"}
【置信度】${ctx.intent?.confidence ?? "N/A"}

一线客服未能完全解决此问题。请你判断：
1. 你自己给出最终解决方案
2. 确实需要人工介入

请用 JSON 格式回复：
{
  "decision": "resolve" 或 "escalate_to_human",
  "resolution": "给客户的回复内容，语气温暖专业",
  "reasoning": "你做出这个判断的理由",
  "actionItems": ["后续行动项1", "后续行动项2"]
}`;

    const response = await LLMService.complete(this.systemPrompt, contextPrompt, {
      jsonOutput: true,
    });

    const decision = this.parseDecision(response);

    return {
      agentType: this.type,
      content: decision.resolution,
      metadata: {
        supervisorDecision: decision.decision,
        reasoning: decision.reasoning,
        actionItems: decision.actionItems,
      },
      nextAgent: undefined,
      shouldEscalate: decision.decision === "escalate_to_human",
    };
  }

  private parseDecision(raw: string): {
    decision: string;
    resolution: string;
    reasoning: string;
    actionItems: string[];
  } {
    try {
      return JSON.parse(raw);
    } catch {
      return {
        decision: "escalate_to_human",
        resolution: "This case requires human review. Our support team will contact you shortly.",
        reasoning: "Unable to process automated decision, defaulting to human escalation",
        actionItems: ["Assign to human support agent", "Send acknowledgment to customer"],
      };
    }
  }
}

// Auto-register
AgentRegistry.register(new SupervisorAgent());
