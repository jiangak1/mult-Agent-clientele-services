import { BaseAgent, AgentRegistry } from "./base-agent";
import { RAGEngine } from "@/lib/rag/rag-engine";
import { ComplaintService } from "@/lib/services/complaint-service";
import { InventoryService } from "@/lib/services/inventory-service";
import { LongTermMemory } from "@/lib/memory/long-term-memory";
import { cvAdapter } from "@/lib/adapters/cv-adapter";
import type { AgentContext, AgentResult, AgentType } from "@/types";

const AFTERSALE_SYSTEM_PROMPT = `你是一位名叫"小C"的售后客服专员。你真诚、有同理心、耐心细致，用温暖的话语化解客户的不满和焦虑。

## 核心行为准则

### 1. 对话开场规则
- **仅在对话的第一条消息**做简短自我介绍和打招呼
- **后续回复直接进入主题**，不要重复"您好我是小C"，不要重复打招呼和自我介绍
- 后续回复像朋友继续聊天一样自然接话

### 2. 感同身受
- 客户不满时，第一句话必须是真诚的道歉和理解："非常理解您的心情...""换作是我也会很着急的..."
- 用"我听到您..."来回放客户的问题，表明你真的在认真听
- 不要说"这是规定""没办法"——先共情，再解释，最后给出路

### 3. 耐心引导
- 不要一上来就给结论，先仔细收集信息：什么时候买的？怎么出现的？有没有照片？
- 分步骤引导客户排查问题，每一步解释为什么要这样做
- 客户急躁时不要急，用"不着急，我们一步一步来"安抚对方
- 技术术语要用通俗的话解释，确保客户理解每一步

### 4. 细心周全
- 主动提醒客户可能关联的问题（如"数据备份了吗？""保修期内吗？"）
- 给出多个解决方案，帮客户分析每个方案的优缺点
- 承诺的时间要留有余地，并告知可能的延迟原因
- 问题解决后主动问"还有其他需要帮您的吗？"

### 5. 客服红线（绝对禁止）
- 禁止冷漠："这是你自己弄坏的""谁让你不按说明操作"
- 禁止推诿："这个不归我们管""你去找厂家"
- 禁止编造解决方案或虚假承诺
- 禁止对客户发脾气或不耐烦
- 不确定的事情说"我帮您核实一下，请稍等"

## 售后处理流程
1. **先道歉安抚** → 真诚承认问题，表达理解
2. **收集信息** → 温和地询问关键细节（购买时间、问题描述、是否有照片）
3. **分析定位** → 判断问题类型（产品质量/使用问题/物流损坏），用客户能懂的语言解释
4. **给出方案** → 提供 1-3 个解决方案，按推荐程度排列，说明各自的优缺点和时间
5. **确认执行** → 引导客户选择方案，告知后续步骤和时间节点
6. **闭环跟进** → 主动告知后续会有通知，留下联系方式

## 库存信息规则
- 绝对禁止告诉客户具体库存数量
- 涉及换货时只告知"有货可以换"或"该款暂时缺货，建议换其他款式"
- 客户追问库存数时说"库存变化较快，建议尽快确定方案我帮您操作"`;

export class AfterSaleAgent extends BaseAgent {
  readonly type: AgentType = "aftersale";
  readonly capabilities = {
    name: "Aftersale & Complaint Handling",
    description: "Handles complaints, returns, technical issues, and aftersale support",
    tools: [
      "image_analysis",
      "complaint_search",
      "long_term_memory",
      "rag_response",
      "resolution_recommendation",
    ],
  };

  get systemPrompt(): string {
    return AFTERSALE_SYSTEM_PROMPT;
  }

  async canHandle(ctx: AgentContext): Promise<boolean> {
    return (
      ctx.intent?.category === "aftersale" ||
      ctx.intent?.category === "complaint" ||
      ctx.intent?.category === "technical_support"
    );
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    // Step 1: Analyze images if provided
    const imageResults: string[] = [];
    if (ctx.imageUrls && ctx.imageUrls.length > 0) {
      for (const imageUrl of ctx.imageUrls) {
        const result = await cvAdapter.analyze(
          imageUrl,
          "Analyze this product image for defects, damage, or issues. Describe what you see in detail for customer service purposes.",
        );
        imageResults.push(
          `Image Analysis: ${result.description}\nDefects found: ${result.defects.map((d) => `${d.type} (${d.severity}): ${d.description}`).join("; ") || "None"}`,
        );
      }
    }

    const enrichedQuery = [
      ctx.message,
      ...imageResults,
    ].join("\n\n");

    // Step 2: Query local product DB for referenced products
    const inventoryResult = await InventoryService.queryProducts(
      { tenantId: ctx.tenantId },
      { keyword: ctx.message, limit: 5 },
    );

    // Step 3: Search similar complaint cases
    const similarCases = await ComplaintService.searchSimilarCases(
      ctx.tenantId,
      enrichedQuery,
      5,
    );

    // Step 4: RAG response with complaint context
    const { content, sources } = await RAGEngine.query(
      ctx.tenantId,
      enrichedQuery,
      "aftersale",
    );

    // Step 5: Store complaint context in long-term memory
    await LongTermMemory.storeComplaintContext(
      ctx.userId,
      ctx.conversationId,
      {
        query: ctx.message,
        imageCount: ctx.imageUrls?.length ?? 0,
        similarCasesFound: similarCases.length,
        timestamp: new Date().toISOString(),
      },
    );

    // Step 6: Determine if escalation is needed
    const shouldEscalate = this.shouldEscalate(similarCases, ctx);

    const productContext = inventoryResult.products.length > 0
      ? `\n\nRelated Product Info:\n${inventoryResult.products.map((p) => `- ${p.name} (SKU: ${p.sku}): ${p.stock} in stock, ¥${p.price}`).join("\n")}`
      : "";

    const replyContent = content + productContext;

    return {
      agentType: this.type,
      content: replyContent,
      metadata: {
        sources,
        products: inventoryResult.products,
        similarCases: similarCases.map((c) => ({
          id: c.id,
          title: c.title,
          severity: c.severity,
          resolution: c.resolution,
        })),
        imageAnalyses: imageResults,
        processingTime: 0,
      },
      nextAgent: shouldEscalate ? "supervisor" : undefined,
      shouldEscalate,
    };
  }

  private shouldEscalate(
    similarCases: { severity: string; resolution: string | null }[],
    ctx: AgentContext,
  ): boolean {
    // No similar cases = novel issue, handle it ourselves (will be saved for future)
    if (similarCases.length === 0) return false;

    const criticalCases = similarCases.filter((c) => c.severity === "critical");
    const unresolvedSimilar = similarCases.filter((c) => !c.resolution);

    return (
      criticalCases.length > 0 ||
      unresolvedSimilar.length === similarCases.length ||
      (ctx.intent?.confidence ?? 0) < 0.4
    );
  }
}

// Auto-register
AgentRegistry.register(new AfterSaleAgent());
