import type { CVModelAdapter, CVRequest, CVResult } from "@/types";
import { config } from "@/lib/utils/config";

// ============================================
// Adapter Pattern: CV Model Interface
// ============================================

/**
 * Mimo-v2-omni adapter — supports image + video understanding.
 * OpenAI-compatible API with extended multimodal content types.
 */
export class MimoVisionAdapter implements CVModelAdapter {
  private apiKey: string;
  private endpoint: string;
  private model: string;

  constructor() {
    this.apiKey = config.cvModel.apiKey || config.llm.apiKey;
    this.endpoint = config.cvModel.endpoint;
    this.model = config.cvModel.modelName;
  }

  async analyze(imageUrl: string, prompt: string): Promise<CVResult> {
    const isVideo = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(imageUrl)
      || imageUrl.startsWith("data:video/");

    const content: Record<string, unknown>[] = [
      { type: "text", text: prompt },
    ];

    if (isVideo) {
      content.push({
        type: "video_url",
        video_url: { url: imageUrl },
      });
    } else {
      content.push({
        type: "image_url",
        image_url: { url: imageUrl, detail: "auto" },
      });
    }

    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content }],
        max_tokens: 1024,
      }),
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "";

    return this.parseResponse(raw);
  }

  async analyzeBatch(requests: CVRequest[]): Promise<CVResult[]> {
    return Promise.all(requests.map((req) => this.analyze(req.imageUrl, req.prompt ?? "")));
  }

  /**
   * Analyze a single image and return a structured product-oriented description.
   * Tailored for customer service scenarios.
   */
  async analyzeProductImage(imageUrl: string): Promise<string> {
    const prompt = `你是一位专业的电商客服。请仔细观察这张图片，用中文描述：
1. 图片中是什么产品？（品牌、型号、外观特征）
2. 产品的状态如何？（全新、使用痕迹、损坏情况）
3. 用户可能的需求是什么？（想买、售后问题、咨询对比）
请用一段简洁自然的中文描述，不要使用列表格式。`;

    const result = await this.analyze(imageUrl, prompt);
    return result.description;
  }

  async analyzeProductImages(imageUrls: string[]): Promise<string> {
    if (imageUrls.length === 0) return "";
    if (imageUrls.length === 1) return this.analyzeProductImage(imageUrls[0]);

    const results = await Promise.all(imageUrls.map((url) => this.analyzeProductImage(url)));
    return results.map((r, i) => `[图片${i + 1}] ${r}`).join("\n");
  }

  private parseResponse(content: string): CVResult {
    try {
      const parsed = JSON.parse(content);
      return {
        description: parsed.description ?? content,
        tags: parsed.tags ?? [],
        defects: parsed.defects ?? [],
        confidence: parsed.confidence ?? 0.8,
        rawResponse: content,
      };
    } catch {
      return {
        description: content,
        tags: [],
        defects: [],
        confidence: 0.7,
        rawResponse: content,
      };
    }
  }
}

// ============================================
// Legacy adapters (kept for backward compatibility)
// ============================================

export class OpenAIVisionAdapter implements CVModelAdapter {
  private adapter: MimoVisionAdapter;

  constructor() {
    this.adapter = new MimoVisionAdapter();
  }

  async analyze(imageUrl: string, prompt: string): Promise<CVResult> {
    return this.adapter.analyze(imageUrl, prompt);
  }

  async analyzeBatch(requests: CVRequest[]): Promise<CVResult[]> {
    return this.adapter.analyzeBatch(requests);
  }
}

export class LocalCVAdapter implements CVModelAdapter {
  private endpoint: string;

  constructor() {
    this.endpoint = config.cvModel.endpoint;
  }

  async analyze(imageUrl: string, prompt: string): Promise<CVResult> {
    const response = await fetch(`${this.endpoint}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl, prompt }),
    });
    return response.json();
  }

  async analyzeBatch(requests: CVRequest[]): Promise<CVResult[]> {
    const response = await fetch(`${this.endpoint}/analyze/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    return response.json();
  }
}

// ============================================
// CV Adapter Factory
// ============================================

export function createCVAdapter(): CVModelAdapter {
  switch (config.cvModel.type) {
    case "openai":
    case "claude":
    case "mimo":
      return new MimoVisionAdapter();
    case "local":
      return new LocalCVAdapter();
    default:
      return new MimoVisionAdapter();
  }
}

export const cvAdapter: CVModelAdapter = createCVAdapter();
