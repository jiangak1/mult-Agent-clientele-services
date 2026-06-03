import { searchSimilar, createEmbedding } from "@/lib/vector-store/milvus-client";
import { config } from "@/lib/utils/config";
import type { Source, Recommendation } from "@/types";

// ============================================
// RAG (Retrieval-Augmented Generation) Engine
// ============================================

export interface RAGContext {
  sources: Source[];
  systemPrompt: string;
  userPrompt: string;
}

export class RAGEngine {
  /**
   * Build RAG context for a presale inquiry
   */
  static async buildPresaleContext(
    tenantId: string,
    query: string,
    topK = 5,
  ): Promise<RAGContext> {
    const embedding = await createEmbedding(query);

    const knowledgeSources = await searchSimilar(
      config.milvus.collections.knowledge,
      tenantId,
      embedding,
      topK,
    );

    return {
      sources: knowledgeSources,
      systemPrompt: `You are a professional presale customer service agent. Use the following knowledge base articles to answer the customer's question. Cite sources when possible.\n\nKnowledge:\n${knowledgeSources.map((s, i) => `[${i + 1}] ${s.content}`).join("\n\n")}`,
      userPrompt: query,
    };
  }

  /**
   * Build RAG context for an aftersale/complaint inquiry
   */
  static async buildAftersaleContext(
    tenantId: string,
    query: string,
    topK = 5,
  ): Promise<RAGContext> {
    const embedding = await createEmbedding(query);

    const complaintSources = await searchSimilar(
      config.milvus.collections.complaints,
      tenantId,
      embedding,
      topK,
    );

    return {
      sources: complaintSources,
      systemPrompt: `You are a professional aftersale customer service agent. Use the following similar complaint cases and resolutions to address the customer's issue. Be empathetic and solution-oriented.\n\nSimilar Cases:\n${complaintSources.map((s, i) => `[Case ${i + 1}]\nIssue: ${s.content}\nResolution: ${(s as unknown as Record<string, string>).resolution ?? "Not specified"}`).join("\n\n")}`,
      userPrompt: query,
    };
  }

  /**
   * Generate response using LLM with RAG context
   */
  static async generateResponse(context: RAGContext): Promise<string> {
    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: config.llm.temperature,
        max_tokens: config.llm.maxTokens,
        messages: [
          { role: "system", content: context.systemPrompt },
          { role: "user", content: context.userPrompt },
        ],
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  /**
   * Full RAG pipeline: retrieve + generate
   */
  static async query(tenantId: string, userQuery: string, type: "presale" | "aftersale"): Promise<{
    content: string;
    sources: Source[];
  }> {
    const context = type === "presale"
      ? await RAGEngine.buildPresaleContext(tenantId, userQuery)
      : await RAGEngine.buildAftersaleContext(tenantId, userQuery);

    const content = await RAGEngine.generateResponse(context);

    return { content, sources: context.sources };
  }

  /**
   * Generate product/solution recommendations
   */
  static async generateRecommendations(
    tenantId: string,
    userQuery: string,
    sources: Source[],
    count = 3,
  ): Promise<Recommendation[]> {
    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0.3,
        messages: [{
          role: "system",
          content: `Based on the user's query and retrieved knowledge, generate ${count} specific product/solution recommendations. Return JSON array: [{"type":"product|solution|faq","title":"...","description":"...","score":0.xx}]`,
        }, {
          role: "user",
          content: `Query: ${userQuery}\n\nSources:\n${sources.map((s) => s.content).join("\n")}`,
        }],
      }),
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? "[]";
    try {
      return JSON.parse(text);
    } catch {
      return [];
    }
  }
}
