import { BaseAgent, AgentRegistry } from "./base-agent";
import { LLMService } from "@/lib/services/llm-service";
import { RAGEngine } from "@/lib/rag/rag-engine";
import { InventoryService } from "@/lib/services/inventory-service";
import { LongTermMemory } from "@/lib/memory/long-term-memory";
import { cvAdapter } from "@/lib/adapters/cv-adapter";
import { ResponseGuard } from "@/lib/utils/response-guard";
import type { AgentContext, AgentResult, AgentType } from "@/types";

const PRESALE_SYSTEM_PROMPT = `你是一位名叫"小C"的电商客服专员。你真诚、细心、有耐心，说话温暖自然，就像一位乐于助人的朋友。

## 核心行为准则

### 1. 拟人化交流
- 用日常口语化的方式交流，避免官方套话和机械表达
- 适当使用语气词（"呢"、"哦"、"哈"、"呀"），但要自然不刻意
- 像朋友聊天一样：先理解对方需求，再给出建议
- 用"我"而非"系统"自称，用"您"称呼客户
- 适度使用表情符号表达友好（😊👍✨），每轮 1-2 个即可

### 2. 对话开场规则（重要）
- **仅在对话的第一条消息**做简短自我介绍和打招呼（如"您好！我是小C..."）
- **后续回复直接进入主题**，不要重复自我介绍，不要再说"您好我是小C""欢迎来到..."之类的开场
- 后续回复就像朋友继续聊天一样自然接话，不寒暄
- 如果客户换了新话题，自然过渡即可，不需要重新打招呼

### 3. 耐心细致
- 认真读完客户的每句话再回复，不要跳过任何细节
- 如果客户表达不够清晰，温和地引导对方补充，不要直接说"不清楚"
- 对于复杂问题，分步骤解释，先确认需求 → 再给出方案 → 最后确认理解
- 主动询问客户是否有其他需求或疑问
- 客户纠结犹豫时，主动帮对方对比分析，给具体建议而非"您自己决定"

### 4. 细心服务
- 记住并提及客户说过的关键词（如预算、用途、偏好）
- 推荐产品时说明推荐理由，不只列参数
- 主动提示客户可能忽略的细节（如兼容性、配件、使用场景）
- 标注库存紧张的商品，帮客户把握时机
- 对比不同产品时，用具体场景说明区别

### 5. 客服红线（绝对禁止）
- 禁止敷衍："不知道""你自己看""上面写得很清楚"
- 禁止推卸责任："这跟我没关系""这不归我管"
- 禁止编造虚假信息或夸大产品功能
- 禁止对客户不耐烦或不尊重
- 不确定的事情诚实说"我帮您确认一下"，然后给出下一步行动

### 6. 库存信息规则（重要）
- **绝对禁止**主动告诉客户具体库存数量（如"还有25件""库存12台"）
- 正常有货时只需说"有货""现货"即可，不报数字
- 仅在以下情况告知库存状态：
  - 库存紧张时提醒"这款很抢手，目前仅剩少量库存，建议尽快下手哦"
  - 暂时缺货时说"这款暂时缺货，可以帮您留意到货通知"
- 客户主动追问具体库存时，委婉说"库存变化较快，建议现在下单锁定"，不要报数字

## 回复结构参考（非强制模板）
1. 先回应客户的情绪或需求（表示理解和重视）
2. 给出核心答案或推荐
3. 补充细节和理由
4. 主动提出下一步可以帮对方做什么

## 处理产品数据
当系统提供产品数据时，请自然地融入回复中：
- 用"我们目前有 X 款..."比直接丢列表更自然
- 介绍产品时突出跟客户需求相关的卖点
- 价格用口语表达如"这款价格是8999元"
- **库存仅标注状态**（有货/库存紧张/暂时缺货），绝对不能报具体数字
- 如果只有一个产品匹配，也要诚实告知并推荐最接近的替代方案`;

export class PresaleAgent extends BaseAgent {
  readonly type: AgentType = "presale";
  readonly capabilities = {
    name: "Presale & Product Consultation",
    description: "Handles product inquiries, recommendations, and pre-purchase questions",
    tools: [
      "vector_search",
      "inventory_query",
      "recommendation",
      "rag_response",
      "product_comparison",
    ],
  };

  get systemPrompt(): string {
    return PRESALE_SYSTEM_PROMPT;
  }

  async canHandle(ctx: AgentContext): Promise<boolean> {
    return ctx.intent?.category === "presale" || ctx.intent?.category === "general_inquiry";
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    // Step 1: Keyword search for mentioned products
    const keywordResult = await InventoryService.queryProducts(
      { tenantId: ctx.tenantId },
      { keyword: ctx.message, limit: 10 },
    );

    // Step 2: If keyword search found few results, also fetch all products
    // General inquiries and vague queries should show the full catalog
    let products = keywordResult.products;
    const isBrowseQuery = ctx.intent?.category === "general_inquiry"
      || keywordResult.products.length < 2;
    if (isBrowseQuery) {
      const allResult = await InventoryService.queryProducts(
        { tenantId: ctx.tenantId },
        { limit: 20 },
      );
      // Merge: deduplicate by id, keep all products
      const seen = new Set(products.map((p) => p.id));
      for (const p of allResult.products) {
        if (!seen.has(p.id)) {
          products.push(p);
          seen.add(p.id);
        }
      }
    }

    // Step 3: Analyze product images if user sent any
    const hasImages = ctx.imageUrls && ctx.imageUrls.length > 0;
    let imageAnalysis = "";
    let imageMatchedProducts: typeof products = [];
    if (hasImages) {
      try {
        const prompt = "你是一位电商客服。请仔细观察这张图片，用中文简要描述：图片里是什么产品？（品牌、型号、外观特征）产品看起来是什么状态？（全新、使用过、有损坏）用户可能发这张图是想咨询什么？（购买、售后、比价）";
        const results = await cvAdapter.analyzeBatch(
          ctx.imageUrls!.map((url) => ({ imageUrl: url, prompt })),
        );
        imageAnalysis = results.map((r, i) => `[图片${i + 1}] ${r.description}`).join("\n");

        // Step 3b: Use CV descriptions to search for matching products in the catalog
        if (results.length > 0) {
          const searchQuery = results.map((r) => r.description).join(" ");
          const matched = await InventoryService.queryProducts(
            { tenantId: ctx.tenantId },
            { keyword: searchQuery, limit: 5 },
          );
          imageMatchedProducts = matched.products;
        }
      } catch (err) {
        console.warn("[PresaleAgent] Image analysis failed, continuing without:", err);
      }
    }

    // Step 4: RAG search for knowledge base context (FAQs, policies, etc.)
    let knowledgeContext = "";
    try {
      const { content } = await RAGEngine.query(ctx.tenantId, ctx.message, "presale");
      if (content && content.length > 20) {
        knowledgeContext = content;
      }
    } catch {
      // RAG is optional — proceed without it
    }

    // Merge image-matched products (deduplicate by id)
    if (imageMatchedProducts.length > 0) {
      const seen = new Set(products.map((p) => p.id));
      for (const p of imageMatchedProducts) {
        if (!seen.has(p.id)) {
          products.push(p);
          seen.add(p.id);
        }
      }
    }
    const imageMatchedIds = new Set(imageMatchedProducts.map((p) => p.id));

    // Step 5: Build a context-rich prompt for the LLM
    const productLines: string[] = [];
    for (const p of products) {
      let stockLabel: string;
      if (p.stock <= 0) {
        stockLabel = "暂时缺货";
      } else if (p.stock <= 5) {
        stockLabel = "库存紧张（后台剩余不多，建议提醒客户尽快下手）";
      } else {
        stockLabel = "有货";
      }
      const desc = (p.description ?? "") ? ` — ${p.description}` : "";
      const cat = p.category ? ` [分类: ${p.category}]` : "";
      const matched = imageMatchedIds.has(p.id) ? " [图片匹配]" : "";
      const hasProductImages = (p.imageUrls && p.imageUrls.length > 0) ? " [有产品图]" : "";
      productLines.push(`- ${p.name}${cat}${matched}${hasProductImages} | 价格¥${p.price} | ${stockLabel}${desc}`);
    }

    const productContext = products.length > 0
      ? `以下是当前可售产品数据，请融入你的回复中自然介绍:\n${productLines.join("\n")}\n\n【重要规则】库存状态仅标注"有货""库存紧张""暂时缺货"。绝对不能告诉客户具体库存数字。客户问具体数量时委婉说"库存变化较快，建议现在下单锁定"。`
      : "当前暂无产品库存数据。如果客户询问产品，请礼貌说明暂时缺货，并主动提出帮客户留意到货信息。";

    const conversationLength = (ctx.history ?? []).length;
    const isFirstMessage = conversationLength <= 1;
    const introHint = isFirstMessage
      ? "这是对话的第一条消息，可以做简短自我介绍和打招呼。"
      : "这是对话的后续消息，**绝对不要**再自我介绍或打招呼，直接进入主题回复。";

    const userPrompt = [
      `【客户刚才说的话】${ctx.message}`,
      "",
      `【对话状态】${introHint}`,
      "",
      productContext,
      imageAnalysis ? `\n【客户发送的图片分析】\n${imageAnalysis}\n${imageMatchedProducts.length > 0 ? `\n根据图片分析，我们库存中匹配到以下相关产品（已标注"[图片匹配]"）：\n${imageMatchedProducts.map((p) => `- ${p.name}`).join("\n")}\n请优先向客户推荐这些匹配的产品。` : ""}\n客户发了产品图片，请结合图片中的产品信息主动询问客户的具体需求。比如：是想了解这款产品、想购买、还是有售后问题需要帮助？根据图片内容自然引导。` : "",
      knowledgeContext ? `\n【参考资料】\n${knowledgeContext.slice(0, 800)}` : "",
      "",
      "请用温暖、耐心的语气回复客户。记得先回应情绪或需求，再给方案，最后主动问是否需要更多帮助。",
    ].join("\n");

    // Step 5: Generate natural conversational response via LLM
    const content = await LLMService.complete(this.systemPrompt, userPrompt, {
      temperature: 0.6,
      maxTokens: 1536,
    });

    // Step 6: Store product interest in long-term memory
    if (products.length > 0) {
      await LongTermMemory.storeProductInterest(
        ctx.userId,
        products.map((p) => p.id),
        [...new Set(products.map((p) => p.category).filter(Boolean) as string[])],
      ).catch(() => {});
    }

    // Build recommendations from top 3 products
    const recommendations = products.slice(0, 3).map((p, i) => ({
      id: p.id,
      type: "product" as const,
      title: p.name,
      description: `¥${p.price} | ${p.stock <= 0 ? "缺货" : p.stock <= 5 ? "库存紧张" : "有货"}`,
      score: 1 - i * 0.2,
      metadata: { category: p.category },
    }));

    const rawResult = {
      agentType: this.type,
      content,
      metadata: {
        products,
        recommendations,
        knowledgeUsed: !!knowledgeContext,
        imageAnalyzed: hasImages,
        imageUrls: ctx.imageUrls ?? [],
        processingTime: 0,
      },
      nextAgent: undefined as AgentType | undefined,
      shouldEscalate: false,
    };

    // Post-filter: strip any residual sensitive data from LLM output
    const guarded = ResponseGuard.sanitizeAgentResult(rawResult);
    return { ...rawResult, content: guarded.content, metadata: guarded.metadata };
  }
}

// Auto-register
AgentRegistry.register(new PresaleAgent());
