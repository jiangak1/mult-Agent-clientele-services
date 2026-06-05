/**
 * Taobao Mock Adapter
 *
 * Returns simulated Taobao order/product/refund data.
 * Implements PlatformAdapter interface — swap to real Taobao SDK when ready.
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
    platformOrderId: "TB-20260601-001",
    parentOrderId: null,
    status: "completed",
    platformStatus: "TRADE_FINISHED",
    totalAmount: 8999.00,
    shippingFee: 0,
    discountAmount: 200,
    buyerNick: "tb_***user",
    buyerNote: "请发顺丰",
    receiver: {
      name: "张三",
      phone: "138****5678",
      province: "广东省",
      city: "深圳市",
      district: "南山区",
      address: "科技园路1号创新大厦12层",
    },
    items: [
      {
        platformItemId: "oid-1001",
        platformSkuId: "IP16-256-NT",
        title: "iPhone 16 Pro 256GB 原色钛金属",
        price: 8999.00,
        quantity: 1,
        totalAmount: 8999.00,
        imageUrl: "https://img.alicdn.com/xxx.jpg",
        attributes: { "颜色": "原色钛金属", "存储": "256GB" },
        outerSkuId: "IP16-256-NT",
      },
    ],
    orderCreatedAt: new Date("2026-06-01T10:30:00+08:00"),
    paidAt: new Date("2026-06-01T10:31:25+08:00"),
    shippedAt: new Date("2026-06-01T15:00:00+08:00"),
    deliveredAt: new Date("2026-06-03T09:15:00+08:00"),
    platformRaw: { trade_id: 1234567890123456789, buyer_id: 9876543210 },
  },
  {
    platformOrderId: "TB-20260602-002",
    parentOrderId: null,
    status: "shipped",
    platformStatus: "WAIT_BUYER_CONFIRM_GOODS",
    totalAmount: 169.00,
    shippingFee: 10,
    discountAmount: 0,
    buyerNick: "tb_***buyer",
    buyerNote: null,
    receiver: {
      name: "李四",
      phone: "139****9012",
      province: "浙江省",
      city: "杭州市",
      district: "西湖区",
      address: "文三路456号",
    },
    items: [
      {
        platformItemId: "oid-2001",
        platformSkuId: "CASE-IP16-SIL",
        title: "iPhone 16 Pro 硅胶保护壳 银色",
        price: 169.00,
        quantity: 1,
        totalAmount: 169.00,
        imageUrl: null,
        attributes: { "颜色": "银色", "材质": "液态硅胶" },
        outerSkuId: null,
      },
    ],
    orderCreatedAt: new Date("2026-06-02T14:00:00+08:00"),
    paidAt: new Date("2026-06-02T14:01:00+08:00"),
    shippedAt: new Date("2026-06-02T16:30:00+08:00"),
    deliveredAt: null,
    platformRaw: { trade_id: 1234567890123456790 },
  },
  {
    platformOrderId: "TB-20260603-003",
    parentOrderId: null,
    status: "paid",
    platformStatus: "WAIT_SELLER_SEND_GOODS",
    totalAmount: 2499.00,
    shippingFee: 0,
    discountAmount: 500,
    buyerNick: "tb_***wang",
    buyerNote: "麻烦包装好一点",
    receiver: {
      name: "王五",
      phone: "137****3456",
      province: "北京市",
      city: "北京市",
      district: "朝阳区",
      address: "望京SOHO T1 15层",
    },
    items: [
      {
        platformItemId: "oid-3001",
        platformSkuId: "AIRPODS-PRO2",
        title: "AirPods Pro 第二代",
        price: 2499.00,
        quantity: 1,
        totalAmount: 2499.00,
        imageUrl: null,
        attributes: {},
        outerSkuId: "AP-PRO2",
      },
    ],
    orderCreatedAt: new Date("2026-06-03T08:00:00+08:00"),
    paidAt: new Date("2026-06-03T08:01:00+08:00"),
    shippedAt: null,
    deliveredAt: null,
    platformRaw: { trade_id: 1234567890123456791 },
  },
];

const MOCK_PRODUCTS: PlatformProduct[] = [
  {
    platformProductId: "IP16-256-NT",
    title: "iPhone 16 Pro 256GB 原色钛金属",
    price: 8999.00,
    stock: 120,
    category: "手机",
    imageUrls: ["https://img.alicdn.com/ip16-1.jpg"],
    attributes: { "品牌": "Apple", "型号": "iPhone 16 Pro", "颜色": "原色钛金属", "存储": "256GB" },
    description: "A18 Pro 芯片，48MP 主摄，支持 Apple Intelligence",
  },
  {
    platformProductId: "AIRPODS-PRO2",
    title: "AirPods Pro 第二代",
    price: 2499.00,
    stock: 85,
    category: "耳机",
    imageUrls: [],
    attributes: { "品牌": "Apple", "型号": "AirPods Pro 2", "接口": "USB-C" },
    description: "H2 芯片，主动降噪提升 2 倍，自适应透明模式",
  },
];

// ── Adapter Implementation ───────────────────────────────

export class TaobaoAdapter implements PlatformAdapter {
  readonly platform: IntegrationPlatform = "taobao";
  readonly displayName = "淘宝";
  readonly isMock = true;

  // ── Orders ───────────────────────────────────────────

  async getOrder(orderId: string): Promise<PlatformOrder | null> {
    // Simulate network latency
    await delay(80, 200);

    const order = MOCK_ORDERS.find((o) => o.platformOrderId === orderId);
    return order ?? null;
  }

  async searchOrders(options: OrderSearchOptions): Promise<PaginatedResult<PlatformOrder>> {
    await delay(100, 300);

    let filtered = [...MOCK_ORDERS];

    if (options.status?.length) {
      filtered = filtered.filter((o) => options.status!.includes(o.status));
    }
    if (options.startTime) {
      filtered = filtered.filter((o) => o.orderCreatedAt >= options.startTime!);
    }
    if (options.endTime) {
      filtered = filtered.filter((o) => o.orderCreatedAt <= options.endTime!);
    }

    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const total = filtered.length;
    const start = (page - 1) * pageSize;

    return {
      items: filtered.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  }

  async getOrdersByPhone(phone: string, limit = 10): Promise<PlatformOrder[]> {
    await delay(50, 150);

    // Mock: match by last 4 digits
    const last4 = phone.slice(-4);
    return MOCK_ORDERS.filter((o) => o.receiver.phone.endsWith(last4)).slice(0, limit);
  }

  // ── Products ─────────────────────────────────────────

  async getProduct(productId: string): Promise<PlatformProduct | null> {
    await delay(50, 150);
    return MOCK_PRODUCTS.find((p) => p.platformProductId === productId) ?? null;
  }

  async searchProducts(keyword: string, limit = 10): Promise<PlatformProduct[]> {
    await delay(80, 200);
    return MOCK_PRODUCTS
      .filter((p) => p.title.toLowerCase().includes(keyword.toLowerCase()))
      .slice(0, limit);
  }

  // ── Refunds ──────────────────────────────────────────

  async getRefunds(orderId: string): Promise<PlatformRefund[]> {
    await delay(50, 150);

    // Mock: only TB-20260601-001 has a refund history
    if (orderId === "TB-20260601-001") {
      return [];
    }
    return [];
  }

  async getRefund(refundId: string): Promise<PlatformRefund | null> {
    await delay(50, 100);
    return null; // No mock refunds by default
  }

  // ── Health ───────────────────────────────────────────

  async healthCheck(): Promise<number> {
    await delay(10, 50);
    return Math.round(Math.random() * 50 + 20); // 20-70ms simulated
  }
}

// ── Helper ───────────────────────────────────────────────

function delay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
