import { BaseAgent, AgentRegistry } from "./base-agent";
import { LLMService } from "@/lib/services/llm-service";
import type { AgentContext, AgentResult, IntentResult, AgentType } from "@/types";

const INTENT_SYSTEM_PROMPT = `你是一个客服意图分类器。分析用户的消息，将其准确分类到一个类别。

## 类别定义

### aftersale（售后）- 以下情况必须归类为 aftersale：
- 产品质量问题：坏了、有瑕疵、屏幕坏点、不工作、无法开机
- 退换货：退货、退款、换货、申请退货
- 物流问题：发错货、颜色不对、配件缺失、包装破损
- 保修索赔：保修期内、维修、保修
- 使用故障：连不上、没声音、充不进电、死机
- 投诉：投诉、不满、差评

### presale（售前）- 以下情况归类为 presale：
- 产品咨询：有什么、推荐、哪个好、有什么区别
- 价格询问：多少钱、价格、优惠
- 库存询问：有没有货、什么时候到货
- 产品对比：对比、比较

### general_inquiry（一般咨询）：
- 公司信息、营业时间、物流政策等非产品相关的咨询

### technical_support（技术支持）：
- 安装、设置、配置、使用指导（非故障类）

## 关键区分规则
- 出现"坏了""退货""退款""换货""有质量问题""不能用了"等词 → aftersale
- 出现"有什么""推荐""多少钱""哪个好"等词 → presale
- 不确定时根据客户语气判断：抱怨/不满 → aftersale，好奇/询问 → presale

## 输出格式（仅输出JSON）：
{
  "category": "presale|aftersale|general_inquiry|technical_support",
  "subIntent": "具体子类别",
  "confidence": 0.0-1.0,
  "entities": {}
}`;

// Strong aftersale keywords — skip LLM and classify directly
const AFTERSALE_KEYWORDS = [
  "退货", "退款", "换货", "维修", "保修", "坏了", "有瑕疵",
  "质量问题", "不能用了", "投诉", "差评", "坏点", "不工作",
  "无法开机", "死机", "充不进电", "连不上", "没声音", "发错货",
  "颜色不对", "配件缺失", "包装破损", "掉了", "脱胶", "开裂",
  "无效", "不管用", "不灵了",
];

export class IntentClassifierAgent extends BaseAgent {
  readonly type: AgentType = "intent_classifier";
  readonly capabilities = {
    name: "Intent Classification",
    description: "Classifies user messages into intent categories with confidence scores",
    tools: ["intent_detection", "entity_extraction"],
  };

  get systemPrompt(): string {
    return INTENT_SYSTEM_PROMPT;
  }

  async canHandle(_ctx: AgentContext): Promise<boolean> {
    // This agent can always run — it classifies the initial message
    return true;
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    // Quick keyword pre-check for high-confidence aftersale detection
    const isAftersaleKeyword = AFTERSALE_KEYWORDS.some(
      (kw) => ctx.message.includes(kw),
    );

    let intent: IntentResult;
    if (isAftersaleKeyword) {
      intent = {
        category: "aftersale",
        subIntent: "product_defect",
        confidence: 0.95,
        entities: {},
      };
    } else {
      const history = ctx.history
        ?.slice(-5)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n") ?? "";

      const userMsg = history
        ? `${history}\n\n【当前用户消息】${ctx.message}`
        : ctx.message;

      const response = await LLMService.complete(INTENT_SYSTEM_PROMPT, userMsg, {
        temperature: 0.1,
        jsonOutput: true,
      });

      intent = this.parseIntent(response);
    }
    const nextAgent = IntentClassifierAgent.routeToAgent(intent);

    return {
      agentType: this.type,
      content: JSON.stringify(intent),
      metadata: {
        intent: intent.category,
        subIntent: intent.subIntent,
        confidence: intent.confidence,
      },
      nextAgent,
      shouldEscalate: false,
    };
  }

  private parseIntent(raw: string): IntentResult {
    try {
      const parsed = JSON.parse(raw);
      return {
        category: parsed.category ?? "general_inquiry",
        subIntent: parsed.subIntent ?? "unknown",
        confidence: parsed.confidence ?? 0.5,
        entities: parsed.entities ?? {},
      };
    } catch {
      return {
        category: "general_inquiry",
        subIntent: "unclassified",
        confidence: 0.3,
        entities: {},
      };
    }
  }

  static routeToAgent(intent: IntentResult): AgentType {
    switch (intent.category) {
      case "presale":
        return "presale";
      case "aftersale":
      case "complaint":
        return "aftersale";
      case "technical_support":
        return "aftersale";
      default:
        return "presale";
    }
  }
}

// Auto-register
AgentRegistry.register(new IntentClassifierAgent());
