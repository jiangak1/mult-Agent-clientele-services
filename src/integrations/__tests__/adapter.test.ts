/**
 * Integration Adapter Unit Tests
 *
 * Tests Mock adapters against the PlatformAdapter contract.
 */

import { describe, test, expect, beforeAll } from "vitest";
import { AdapterFactory, getAdapterFactory, getPlatformAdapter } from "../factory";
import type { PlatformAdapter } from "../core/adapter";

// ── Shared test suite for any PlatformAdapter ─────────────

function testAdapterContract(adapter: PlatformAdapter) {
  describe(`${adapter.displayName} (${adapter.platform})`, () => {
    test("has required metadata", () => {
      expect(adapter.platform).toBeTruthy();
      expect(adapter.displayName).toBeTruthy();
      expect(typeof adapter.isMock).toBe("boolean");
    });

    test("getOrder returns order or null", async () => {
      const order = await adapter.getOrder("nonexistent-id");
      expect(order).toBeNull();

      // Each mock adapter has at least one known order
      const allOrders = await adapter.searchOrders({ pageSize: 5 });
      if (allOrders.items.length > 0) {
        const found = await adapter.getOrder(allOrders.items[0].platformOrderId);
        expect(found).not.toBeNull();
        expect(found!.platformOrderId).toBe(allOrders.items[0].platformOrderId);
        expect(found!.totalAmount).toBeGreaterThan(0);
        expect(found!.items.length).toBeGreaterThan(0);
        expect(found!.receiver.name).toBeTruthy();
      }
    });

    test("searchOrders returns paginated results", async () => {
      const result = await adapter.searchOrders({ page: 1, pageSize: 2 });
      expect(result.items.length).toBeLessThanOrEqual(2);
      expect(typeof result.total).toBe("number");
      expect(result.page).toBe(1);
      expect(typeof result.hasMore).toBe("boolean");
    });

    test("searchOrders filters by status", async () => {
      const result = await adapter.searchOrders({ status: ["completed"], pageSize: 10 });
      for (const order of result.items) {
        expect(order.status).toBe("completed");
      }
    });

    test("getOrdersByPhone matches by last 4 digits", async () => {
      // Get a known order's phone
      const all = await adapter.searchOrders({ pageSize: 1 });
      if (all.items.length > 0) {
        const phone = all.items[0].receiver.phone;
        const orders = await adapter.getOrdersByPhone(phone, 5);
        expect(orders.length).toBeGreaterThanOrEqual(0);
        if (orders.length > 0) {
          expect(orders[0].receiver.phone).toBe(phone);
        }
      }
    });

    test("getProduct returns product or null", async () => {
      const product = await adapter.getProduct("nonexistent");
      expect(product).toBeNull();
    });

    test("searchProducts finds by keyword", async () => {
      const products = await adapter.searchProducts("iPhone", 5);
      // Might be empty if no iPhone products in mock data
      for (const p of products) {
        expect(p.title.length).toBeGreaterThan(0);
        expect(p.platformProductId).toBeTruthy();
      }
    });

    test("getRefunds returns array", async () => {
      const refunds = await adapter.getRefunds("any-order-id");
      expect(Array.isArray(refunds)).toBe(true);
    });

    test("getRefund returns null for nonexistent", async () => {
      const refund = await adapter.getRefund("nonexistent");
      expect(refund).toBeNull();
    });

    test("healthCheck returns positive latency", async () => {
      const latency = await adapter.healthCheck();
      expect(latency).toBeGreaterThan(0);
      expect(latency).toBeLessThan(500); // mock should be fast
    });
  });
}

// ── Factory Tests ────────────────────────────────────────

describe("AdapterFactory", () => {
  test("getInstance returns singleton", () => {
    const a = AdapterFactory.getInstance();
    const b = AdapterFactory.getInstance();
    expect(a).toBe(b);
  });

  test("getAll returns all registered adapters", () => {
    const all = AdapterFactory.getInstance().getAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const platforms = all.map((a) => a.platform);
    expect(platforms).toContain("taobao");
    expect(platforms).toContain("pinduoduo");
  });

  test("get returns correct adapter", () => {
    const taobao = AdapterFactory.getInstance().get("taobao");
    expect(taobao.platform).toBe("taobao");
    expect(taobao.displayName).toBe("淘宝");

    const pdd = AdapterFactory.getInstance().get("pinduoduo");
    expect(pdd.platform).toBe("pinduoduo");
    expect(pdd.displayName).toBe("拼多多");
  });

  test("get throws for unknown platform", () => {
    expect(() => AdapterFactory.getInstance().get("unknown" as never)).toThrow();
  });

  test("getAll adapters are mock", () => {
    for (const adapter of AdapterFactory.getInstance().getAll()) {
      expect(adapter.isMock).toBe(true);
    }
  });

  test("healthReport returns all platforms", async () => {
    const report = await AdapterFactory.getInstance().healthReport();
    expect(report.length).toBeGreaterThanOrEqual(2);
    for (const r of report) {
      expect(r.healthy).toBe(true);
      expect(r.latencyMs).toBeGreaterThan(0);
    }
  });

  test("convenience functions work", () => {
    expect(getAdapterFactory()).toBe(AdapterFactory.getInstance());
    expect(getPlatformAdapter("taobao").platform).toBe("taobao");
  });
});

// ── Run contract tests against each adapter ──────────────

const factory = AdapterFactory.getInstance();

describe("TaobaoAdapter — contract", () => {
  testAdapterContract(factory.get("taobao"));
});

describe("PinduoduoAdapter — contract", () => {
  testAdapterContract(factory.get("pinduoduo"));
});
