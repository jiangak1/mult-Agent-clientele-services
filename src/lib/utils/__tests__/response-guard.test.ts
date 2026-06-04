/**
 * ResponseGuard unit tests — validates that all sensitive data patterns
 * are caught and sanitized before delivery to the client.
 */

import { describe, test, expect, vi } from "vitest";
import { ResponseGuard, guardResponse } from "../response-guard";

// ── Helpers ───────────────────────────────────────────────────

function expectClean(input: string, rule: string) {
  const result = ResponseGuard.sanitize(input);
  if (result.changed) {
    console.log(`[clean] "${input}" → "${result.sanitized}"`);
  }
  // The sanitized output must not contain the raw stock number pattern
  expect(result.sanitized).not.toMatch(/\d+\s*(?:件|个|台|套|部|只)/);
  // The sanitized output must not contain SKU patterns
  expect(result.sanitized).not.toMatch(/SKU\s*[：:]\s*[A-Za-z0-9_-]+/i);
}

function expectViolation(input: string, expectedRule: string) {
  const result = ResponseGuard.sanitize(input);
  const ruleNames = result.violations.map((v) => v.rule);
  expect(ruleNames).toContain(expectedRule);
}

function expectNoViolation(input: string) {
  const result = ResponseGuard.sanitize(input);
  expect(result.violations).toHaveLength(0);
}

// ── Stock Quantity Leaks ──────────────────────────────────────

describe("stock quantity", () => {
  test("库存 + 数量 + 件", () => {
    const r = ResponseGuard.sanitize("这款产品库存25件，可以下单。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("有货");
    expect(r.sanitized).not.toMatch(/25/);
  });

  test("库存 + 数量 + 台", () => {
    const r = ResponseGuard.sanitize("目前库存15台。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/15/);
  });

  test("还剩 + 数量 + 个", () => {
    const r = ResponseGuard.sanitize("还剩8个，要买的话尽快。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/\b8\b/);
  });

  test("只有 + 数量 + 件", () => {
    const r = ResponseGuard.sanitize("只有3件库存了。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/\b3\b/);
  });

  test("仅剩 + 数量 + 台", () => {
    const r = ResponseGuard.sanitize("仅剩2台，欲购从速。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/\b2\b/);
  });

  test("余量 + 数量 + 套", () => {
    const r = ResponseGuard.sanitize("余量12套。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/12/);
  });

  test("bare number + 件 (small quantity → 少量)", () => {
    const r = ResponseGuard.sanitize("目前大概2件左右。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("少量");
    expect(r.sanitized).not.toMatch(/\b2\b/);
  });

  test("bare number + 台 (large → 有货)", () => {
    const r = ResponseGuard.sanitize("这个型号50台现货。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("有货");
    expect(r.sanitized).not.toMatch(/\b50\b/);
  });

  test("parenthetical stock count", () => {
    const r = ResponseGuard.sanitize("（库存15）这款很受欢迎。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("(有货)");
  });

  test("bracket stock count", () => {
    const r = ResponseGuard.sanitize("[剩3件]这个颜色不多了。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("(有货)");
  });

  test("English: X in stock", () => {
    const r = ResponseGuard.sanitize("We have 25 in stock for this model.");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("available");
    expect(r.sanitized).not.toMatch(/25/);
  });

  test("English: X units left", () => {
    const r = ResponseGuard.sanitize("Only 3 units left in the warehouse.");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/\b3\b/);
  });
});

// ── SKU Leaks ─────────────────────────────────────────────────

describe("SKU", () => {
  test("SKU: prefix", () => {
    const r = ResponseGuard.sanitize("您关注的商品 SKU: PROD-2024-ABC 已经上架。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/PROD-2024-ABC/);
    expect(r.sanitized).not.toMatch(/SKU\s*[：:]/i);
  });

  test("| SKU: inline", () => {
    const r = ResponseGuard.sanitize("- 商品A | SKU:XYZ-123 | 价格¥99");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/XYZ-123/);
    expect(r.sanitized).not.toMatch(/SKU/i);
  });
});

// ── Cost Price Leaks ──────────────────────────────────────────

describe("cost price", () => {
  test("成本价", () => {
    const r = ResponseGuard.sanitize("成本价 50 元，售价 99 元。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("***");
    expect(r.sanitized).not.toMatch(/50/);
    expect(r.sanitized).toContain("售价 99 元"); // retail price preserved
  });

  test("进价", () => {
    const r = ResponseGuard.sanitize("进价：¥120");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("***");
  });

  test("出厂价", () => {
    const r = ResponseGuard.sanitize("出厂价 200块");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("***");
  });
});

// ── Supplier Info Leaks ───────────────────────────────────────

describe("supplier info", () => {
  test("供应商名称", () => {
    const r = ResponseGuard.sanitize("供应商：深圳华强电子有限公司提供。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/深圳华强/);
    expect(r.sanitized).toContain("合作厂商");
  });

  test("厂家电话", () => {
    const r = ResponseGuard.sanitize("厂家电话：13800138000");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("***");
  });

  test("供货商联系信息", () => {
    const r = ResponseGuard.sanitize("供货商微信：supplier_wx_001");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("***");
  });
});

// ── Internal Notes ────────────────────────────────────────────

describe("internal notes", () => {
  test("【内部备注】", () => {
    const r = ResponseGuard.sanitize("这款产品不错。【内部备注】该客户去年退款过需要留意。需要下单吗？");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/退款过/);
  });

  test("[勿展示]", () => {
    const r = ResponseGuard.sanitize("可以为您推荐这款。[勿展示]价格可下浮5%。需要下单吗？");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/可下浮/);
  });

  test("(内部用)", () => {
    const r = ResponseGuard.sanitize("(内部用)成本已涨至180。这款目前价格很合适。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).not.toMatch(/成本已涨/);
  });
});

// ── UUID Leaks ────────────────────────────────────────────────

describe("UUID", () => {
  test("uuid in text", () => {
    const r = ResponseGuard.sanitize("您的订单号是 550e8400-e29b-41d4-a716-446655440000 请查收。");
    expect(r.changed).toBe(true);
    expect(r.sanitized).toContain("***");
    expect(r.sanitized).not.toMatch(/550e8400/);
  });
});

// ── UUID / internal IDs ───────────────────────────────────────

describe("sanitizeAgentResult", () => {
  test("removes sku from metadata", () => {
    const result = ResponseGuard.sanitizeAgentResult({
      content: "这款手机很不错哦，价格是5999元。",
      metadata: {
        products: [{ id: "p1", name: "iPhone", sku: "IP16-256-BLK", stock: 25 }],
        recommendations: [{ description: "¥5999 | 库存25件", metadata: { sku: "IP16-256-BLK" } }],
      },
    });

    // Check that stock is abstracted in metadata
    const products = result.metadata.products as Array<Record<string, unknown>>;
    expect(products[0]).not.toHaveProperty("sku");
    expect(products[0]).toHaveProperty("stockLabel", "有货");
    expect(products[0]).not.toHaveProperty("stock");

    // Check recommendations description is sanitized
    const recs = result.metadata.recommendations as Array<Record<string, unknown>>;
    expect(recs[0].description).not.toMatch(/25/);
    expect(recs[0].description).toContain("有货");
    const recMetadata = recs[0].metadata as Record<string, unknown>;
    expect(recMetadata).not.toHaveProperty("sku");
  });

  test("preserves clean content unchanged", () => {
    const input = {
      content: "您好，这款产品目前有货，价格是8999元。需要帮您下单吗？",
      metadata: { category: "phone" },
    };
    const result = ResponseGuard.sanitizeAgentResult(input);
    expect(result.content).toBe(input.content);
    expect(result.metadata).toEqual({ category: "phone" });
  });

  test("logs violations for debugging", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    ResponseGuard.sanitizeAgentResult({
      content: "这款产品库存25件，SKU: PROD-001。",
      metadata: {},
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── Edge Cases ─────────────────────────────────────────────────

describe("edge cases", () => {
  test("price (¥) is NOT filtered", () => {
    const r = ResponseGuard.sanitize("这款价格是8999元，非常划算。");
    expect(r.sanitized).toContain("8999元");
  });

  test("specs (尺寸/内存) are NOT filtered", () => {
    const r = ResponseGuard.sanitize("这款是15.6英寸屏幕，16GB内存，512GB存储。");
    expect(r.sanitized).toContain("15.6英寸");
    expect(r.sanitized).toContain("16GB");
    expect(r.sanitized).toContain("512GB");
  });

  test("discount percentage is NOT filtered", () => {
    const r = ResponseGuard.sanitize("目前打8折，很优惠哦。");
    expect(r.sanitized).toContain("8折");
  });

  test("legitimate stock labels pass through", () => {
    const r = ResponseGuard.sanitize("这款产品有货，另一款库存紧张，还有一款暂时缺货。");
    expect(r.changed).toBe(false);
    expect(r.sanitized).toContain("有货");
    expect(r.sanitized).toContain("库存紧张");
    expect(r.sanitized).toContain("缺货");
  });

  test("mixed content: multiple violation types", () => {
    const input = "商品A库存25件，SKU: ABC-123，成本价50元。供应商：深圳某厂。";
    const r = ResponseGuard.sanitize(input);
    // Should trigger at least stock, SKU, cost
    expect(r.violations.length).toBeGreaterThanOrEqual(3);
    expect(r.sanitized).not.toMatch(/25/);
    expect(r.sanitized).not.toMatch(/ABC-123/);
    expect(r.sanitized).not.toMatch(/50元/);
    expect(r.sanitized).not.toMatch(/深圳某厂/);
  });

  test("empty string", () => {
    const r = ResponseGuard.sanitize("");
    expect(r.changed).toBe(false);
    expect(r.violations).toHaveLength(0);
  });

  test("no sensitive content", () => {
    const r = ResponseGuard.sanitize("您好，有什么可以帮您的？");
    expect(r.changed).toBe(false);
    expect(r.violations).toHaveLength(0);
  });
});

// ── Convenience export ────────────────────────────────────────

describe("guardResponse", () => {
  test("returns sanitized string directly", () => {
    const result = guardResponse("库存100件现货");
    expect(result).not.toMatch(/100/);
    expect(result).toContain("有货");
  });
});
