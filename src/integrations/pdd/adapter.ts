/**
 * Pinduoduo (拼多多) Mock Adapter
 *
 * Returns simulated PDD order/product/refund data.
 * Implements PlatformAdapter interface — swap to real PDD SDK when ready.
 */

import type { PlatformAdapter } from "../core/adapter";
import type {
  IntegrationPlatform,
  PlatformOrder,
  PlatformProduct,
  PlatformRefund,
  OrderSearchOptions,
  PaginatedResult,
} from "../core/types";

// ── Mock Data ────────────────────────────────────────────

const MOCK_ORDERS: PlatformOrder[] = [
  {
    platformOrderId: "PDD-20260528-001",
    parentOrderId: null,
    status: "completed",
    platformStatus: "3",  // 已签收
    totalAmount: 29.90,
    shippingFee: 0,
    discountAmount: 10.00,
    buyerNick: "pdd_***user",
    buyerNote: null,
    receiver: {
      name: "张三",
      phone: "138****5678",
      province: "广东省",
      city: "广州市",
      district: "天河区",
      address: "体育西路100号",
    },
    items: [
      {
        platformItemId: "pdd-item-5001",
        platformSkuId: "CASE-IP16-TPU",
        title: "iPhone 16 Pro 透明TPU手机壳 防摔",
        price: 29.90,
        quantity: 1,
        totalAmount: 29.90,
        imageUrl: null,
        attributes: { "颜色": "透明", "材质": "TPU" },
        outerSkuId: null,
      },
    ],
    orderCreatedAt: new Date("2026-05-28T20:00:00+08:00"),
    paidAt: new Date("2026-05-28T20:01:00+08:00"),
    shippedAt: new Date("2026-05-29T10:00:00+08:00"),
    deliveredAt: new Date("2026-06-01T14:00:00+08:00"),
    platformRaw: { order_sn: "PDD-20260528-001" },
  },
  {
    platformOrderId: "PDD-20260602-002",
    parentOrderId: null,
    status: "refunding",
    platformStatus: "1",  // 处理中
    totalAmount: 59.00,
    shippingFee: 0,
    discountAmount: 0,
    buyerNick: "pdd_***buyer",
    buyerNote: "质量太差，要退货",
    receiver: {
      name: "赵六",
      phone: "136****7890",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      address: "张江高科技园区",
    },
    items: [
      {
        platformItemId: "pdd-item-6001",
        platformSkuId: "CHARGER-65W-GAN",
        title: "65W 氮化镓充电器 Type-C 快充",
        price: 59.00,
        quantity: 1,
        totalAmount: 59.00,
        imageUrl: null,
        attributes: { "功率": "65W", "接口": "Type-C", "协议": "PD3.0" },
        outerSkuId: null,
      },
    ],
    orderCreatedAt: new Date("2026-06-02T11:00:00+08:00"),
    paidAt: new Date("2026-06-02T11:01:00+08:00"),
    shippedAt: new Date("2026-06-02T16:00:00+08:00"),
    deliveredAt: new Date("2026-06-04T10:00:00+08:00"),
    platformRaw: { order_sn: "PDD-20260602-002" },
  },
];

const MOCK_REFUNDS: PlatformRefund[] = [
  {
    platformRefundId: "PDD-REF-001",
    platformOrderId: "PDD-20260602-002",
    type: "return",
    status: "approved",
    reason: "商品质量问题，充电发热严重",
    amount: 59.00,
    description: "已退回，等待商家收货确认",
    createdAt: new Date("2026-06-04T12:00:00+08:00"),
    resolvedAt: null,
  },
];

const MOCK_PRODUCTS: PlatformProduct[] = [
  {
    platformProductId: "CHARGER-65W-GAN",
    title: "65W 氮化镓充电器 Type-C 快充",
    price: 59.00,
    stock: 2000,
    category: "充电器",
    imageUrls: [],
    attributes: { "功率": "65W", "接口": "Type-C", "协议": "PD3.0/PPS" },
    description: "GaN 氮化镓技术，体积缩小 50%，兼容 iPhone/Android/笔记本",
  },
  {
    platformProductId: "CASE-IP16-TPU",
    title: "iPhone 16 Pro 透明TPU手机壳",
    price: 29.90,
    stock: 5000,
    category: "手机配件",
    imageUrls: [],
    attributes: { "材质": "TPU", "颜色": "透明", "特性": "防摔/不发黄" },
    description: "进口 TPU 材质，高清透明，1.5米防摔",
  },
];

// ── Adapter Implementation ───────────────────────────────

export class PinduoduoAdapter implements PlatformAdapter {
  readonly platform: IntegrationPlatform = "pinduoduo";
  readonly displayName = "拼多多";
  readonly isMock = true;

  // ── Orders ───────────────────────────────────────────

  async getOrder(orderId: string): Promise<PlatformOrder | null> {
    await delay(80, 200);
    return MOCK_ORDERS.find((o) => o.platformOrderId === orderId) ?? null;
  }

  async searchOrders(options: OrderSearchOptions): Promise<PaginatedResult<PlatformOrder>> {
    await delay(100, 250);
    let filtered = [...MOCK_ORDERS];
    if (options.status?.length) {
      filtered = filtered.filter((o) => options.status!.includes(o.status));
    }
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const total = filtered.length;
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total, page, pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async getOrdersByPhone(phone: string, limit = 10): Promise<PlatformOrder[]> {
    await delay(50, 120);
    const last4 = phone.slice(-4);
    return MOCK_ORDERS.filter((o) => o.receiver.phone.endsWith(last4)).slice(0, limit);
  }

  // ── Products ─────────────────────────────────────────

  async getProduct(productId: string): Promise<PlatformProduct | null> {
    await delay(40, 120);
    return MOCK_PRODUCTS.find((p) => p.platformProductId === productId) ?? null;
  }

  async searchProducts(keyword: string, limit = 10): Promise<PlatformProduct[]> {
    await delay(60, 180);
    return MOCK_PRODUCTS
      .filter((p) => p.title.includes(keyword))
      .slice(0, limit);
  }

  // ── Refunds ──────────────────────────────────────────

  async getRefunds(orderId: string): Promise<PlatformRefund[]> {
    await delay(50, 120);
    return MOCK_REFUNDS.filter((r) => r.platformOrderId === orderId);
  }

  async getRefund(refundId: string): Promise<PlatformRefund | null> {
    await delay(40, 100);
    return MOCK_REFUNDS.find((r) => r.platformRefundId === refundId) ?? null;
  }

  // ── Health ───────────────────────────────────────────

  async healthCheck(): Promise<number> {
    await delay(10, 40);
    return Math.round(Math.random() * 40 + 15);
  }
}

// ── Helper ───────────────────────────────────────────────

function delay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
