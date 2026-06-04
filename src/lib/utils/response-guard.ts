/**
 * ResponseGuard — post-processes agent outputs to strip sensitive data
 * before delivery to the client. Works as a safety net: preventive fixes
 * in each agent keep most leaks from entering the prompt, and this layer
 * catches any LLM-generated numbers or residual leaks.
 */

export interface GuardViolation {
  rule: string;
  matched: string;
  index: number;
}

export interface GuardResult {
  sanitized: string;
  violations: GuardViolation[];
  changed: boolean;
}

// ── Rule Definitions ──────────────────────────────────────────

interface GuardRule {
  name: string;
  pattern: RegExp;
  replacement: string | ((substring: string, ...args: string[]) => string);
}

const RULES: GuardRule[] = [
  // ── Stock quantity ────────────────────────────────────────
  // Order matters: paren rule first (catches [剩3件] before other rules strip the digits),
  // then specific prefixes, then bare number+unit as catch-all.
  {
    name: "stock_count_paren",
    // (库存15) / [剩3件] — runs first to catch bracketed quantities whole
    pattern: /[（(\[]\s*(?:库存|还剩|只有|仅剩|剩|仅|余量)\s*\d+\s*(?:件|个|台|套)?\s*[）)\]]/g,
    replacement: "(有货)",
  },
  {
    name: "stock_quantity_cn",
    // 库存25件 / 还剩12台 / 只有3个 / 余量8套
    pattern: /(?:库存|还剩|只有|仅剩|余量|剩余|现存)\s*\d+\s*(?:件|个|台|套|部|只|条|双|盒|箱|瓶|袋)/g,
    replacement: "有货",
  },
  {
    name: "stock_quantity_digits_cn",
    // 还有 15 件 / 剩 3 台
    pattern: /(?:还有|剩|仅)\s*\d+\s*(?:件|个|台|套|部|只|条|双|盒|箱|瓶|袋)/g,
    replacement: "还有少量",
  },
  {
    name: "stock_quantity_count",
    // 15件 / 3台 / 8个 (bare number + unit, without 库存 prefix)
    // 中文无 word boundary，用 (?<![0-9]) 替代 \b
    pattern: /(?<![¥$￥0-9])(\d{1,5})\s*(件|台|套|部)(?!(?:\s*(?:元|块|钱|¥|\$|折|%|寸|英寸|克|kg|升|ml|瓦|W|Hz|核|GB|TB|MB|像素|万|亿|倍)))/g,
    replacement: (_m: string, digits: string): string => {
      const n = parseInt(digits, 10);
      return n <= 3 ? "少量" : "有货";
    },
  },
  {
    name: "stock_quantity_en",
    // 12 in stock / 3 units left / only 5 remaining
    pattern: /\b(\d{1,5})\s*(?:in stock|units?\s*(?:left|available|remaining)|items?\s*(?:left|available|remaining)|pieces?\s*(?:left|available|remaining))\b/gi,
    replacement: "available",
  },

  // ── SKU ────────────────────────────────────────────────────
  {
    name: "sku_explicit",
    // SKU: ABC-123 / SKU:PROD_001 / sku: xyz
    pattern: /SKU\s*[：:]\s*[A-Za-z0-9_-]+/gi,
    replacement: "",
  },
  {
    name: "sku_inline_prefix",
    // | SKU:ABC-123
    pattern: /\|\s*SKU\s*[：:]\s*[A-Za-z0-9_-]+/gi,
    replacement: "",
  },

  // ── Cost price / internal pricing ──────────────────────────
  {
    name: "cost_price",
    // 成本价 50 / 进价 120 / 进货价 80
    pattern: /(?:成本价|进价|进货价|拿货价|出厂价|批发价|内部价)\s*[：:]*\s*(?:¥|￥|元)?\s*\d+(?:\.\d{1,2})?\s*(?:元|块)?/g,
    replacement: "***",
  },

  // ── Supplier info ──────────────────────────────────────────
  {
    name: "supplier_info",
    // 供应商：XX公司 / 厂家：XX
    pattern: /(?:供应商|厂家|供货商|生产商|代工厂)\s*[：:]\s*\S+/g,
    replacement: "合作厂商",
  },
  {
    name: "supplier_contact",
    // 供应商电话/地址
    pattern: /(?:供应商|厂家|供货商)\s*(?:电话|地址|联系人|微信|邮箱)\s*[：:]\s*\S+/g,
    replacement: "***",
  },

  // ── Internal notes ─────────────────────────────────────────
  // Order matters: internal_note captures marker + trailing content first;
  // internal_marker catches any remaining standalone markers.
  {
    name: "internal_note",
    // 【内部备注】内容... / [勿展示]内容... / (内部用)内容...
    pattern: /[【\[\(（][^】\]\)）]*(?:内部备注|内部标注|内部提醒|综合内部|仅内部|勿告知客户|勿展示|内部用|不对外|对内|内部)[^】\]\)）]*[】\]\)）]\s*[：:]*\s*.{0,200}?(?=[。\n]|$)/g,
    replacement: "",
  },
  {
    name: "internal_marker",
    // Standalone: [勿展示] / (内部用) — no trailing content consumed
    pattern: /[【\[\(（][^】\]\)）]*(?:勿展示|内部用|不对外|对内|仅内部可见|内部)[^】\]\)）]*[】\]\)）]/g,
    replacement: "",
  },

  // ── UUID / internal IDs ────────────────────────────────────
  {
    name: "internal_uuid",
    // UUIDs should never appear in customer-facing text
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: "***",
  },
];

// ── Public API ────────────────────────────────────────────────

export class ResponseGuard {
  /**
   * Sanitize a single text string (LLM output).
   * Returns sanitized text + list of violations found.
   */
  static sanitize(content: string): GuardResult {
    let sanitized = content;
    const violations: GuardViolation[] = [];

    for (const rule of RULES) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        violations.push({
          rule: rule.name,
          matched: match[0],
          index: match.index,
        });
      }
      if (typeof rule.replacement === "function") {
        sanitized = sanitized.replace(pattern, rule.replacement);
      } else {
        sanitized = sanitized.replace(pattern, rule.replacement);
      }
    }

    // Clean up artifacts: double spaces, trailing pipes, empty parens
    sanitized = sanitized
      .replace(/\|\s*\|/g, "")
      .replace(/\(\s*\)/g, "")
      .replace(/\[\s*\]/g, "")
      .replace(/[|]\s*$/gm, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    return {
      sanitized,
      violations,
      changed: violations.length > 0,
    };
  }

  /**
   * Sanitize a GuardResult (from any agent's execute()) — removes
   * sensitive data from content AND metadata fields.
   */
  static sanitizeAgentResult(result: {
    content: string;
    metadata?: Record<string, unknown>;
  }): { content: string; metadata: Record<string, unknown> } {
    const { sanitized, violations } = ResponseGuard.sanitize(result.content);

    if (violations.length > 0) {
      console.warn(
        `[ResponseGuard] ${violations.length} violation(s) in agent output:`,
        violations.map((v) => `${v.rule}("${v.matched}")`).join(", "),
      );
    }

    // Strip sensitive fields from metadata (the metadata is sent to client)
    const cleanMetadata = result.metadata
      ? ResponseGuard.sanitizeMetadata(result.metadata)
      : {};

    return { content: sanitized, metadata: cleanMetadata };
  }

  /**
   * Remove sensitive keys from metadata objects recursively.
   */
  private static sanitizeMetadata(
    obj: Record<string, unknown>,
  ): Record<string, unknown> {
    const SENSITIVE_KEYS = new Set([
      "sku",
      "internalNote",
      "supplier",
      "costPrice",
      "cost",
      "vendorInfo",
      "internalMemo",
    ]);

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(key)) continue;

      if (key === "stock" && typeof value === "number") {
        // Abstract stock to a label
        cleaned["stockLabel"] =
          value <= 0 ? "缺货" : value <= 5 ? "库存紧张" : "有货";
        continue;
      }

      if (key === "description" && typeof value === "string") {
        // Run sanitize on description fields (they may contain stock numbers)
        cleaned[key] = ResponseGuard.sanitize(value).sanitized;
        continue;
      }

      if (Array.isArray(value)) {
        cleaned[key] = value.map((item) => {
          if (typeof item === "object" && item !== null) {
            return ResponseGuard.sanitizeMetadata(
              item as Record<string, unknown>,
            );
          }
          return item;
        });
        continue;
      }

      if (typeof value === "object" && value !== null) {
        cleaned[key] = ResponseGuard.sanitizeMetadata(
          value as Record<string, unknown>,
        );
        continue;
      }

      cleaned[key] = value;
    }
    return cleaned;
  }
}

/**
 * Convenience: filter a single content string.
 */
export function guardResponse(content: string): string {
  return ResponseGuard.sanitize(content).sanitized;
}
