import { config } from "@/lib/utils/config";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class LLMService {
  /**
   * Send a chat completion request
   */
  static async chat(
    messages: LLMMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      responseFormat?: "text" | "json_object";
    },
  ): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: config.llm.model,
      temperature: options?.temperature ?? config.llm.temperature,
      max_tokens: options?.maxTokens ?? config.llm.maxTokens,
      messages,
    };

    if (options?.responseFormat) {
      body.response_format = { type: options.responseFormat };
    }

    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`LLM API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      model: data.model ?? config.llm.model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  /**
   * Simple text completion
   */
  static async complete(
    systemPrompt: string,
    userMessage: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      jsonOutput?: boolean;
    },
  ): Promise<string> {
    const result = await LLMService.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        responseFormat: options?.jsonOutput ? "json_object" : "text",
      },
    );
    return result.content;
  }
}
