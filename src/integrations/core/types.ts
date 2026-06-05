/**
 * Integration Core Types — platform-independent integration contracts.
 *
 * All platform adapters normalize to these types.
 * Matches the Order Domain's UnifiedOrder model for seamless interop.
 */

// ── Platform ─────────────────────────────────────────────

export type IntegrationPlatform = "taobao" | "pinduoduo" | "douyin" | "jd";

// ── Order ────────────────────────────────────────────────

export type PlatformOrderStatus =
  | "pending_payment" | "paid" | "shipped" | "delivered"
  | "completed" | "cancelled" | "refunding" | "refunded";

export interface PlatformOrder {
  platformOrderId: string;
  parentOrderId: string | null;
  status: PlatformOrderStatus;
  platformStatus: string;
  totalAmount: number;
  shippingFee: number;
  discountAmount: number;
  buyerNick: string;
  buyerNote: string | null;
  receiver: PlatformReceiver;
  items: PlatformOrderItem[];
  orderCreatedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  platformRaw: Record<string, unknown>;
}

export interface PlatformReceiver {
  name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  address: string;
}

export interface PlatformOrderItem {
  platformItemId: string;
  platformSkuId: string;
  title: string;
  price: number;
  quantity: number;
  totalAmount: number;
  imageUrl: string | null;
  attributes: Record<string, string>;
  outerSkuId: string | null;
}

// ── Product ──────────────────────────────────────────────

export interface PlatformProduct {
  platformProductId: string;
  title: string;
  price: number;
  stock: number;
  category: string | null;
  imageUrls: string[];
  attributes: Record<string, string>;
  description: string | null;
}

// ── Refund / After-Sale ──────────────────────────────────

export type PlatformRefundStatus =
  | "pending" | "approved" | "rejected"
  | "buyer_shipped" | "received" | "refunding"
  | "completed" | "closed";

export type PlatformRefundType = "refund" | "return" | "exchange";

export interface PlatformRefund {
  platformRefundId: string;
  platformOrderId: string;
  type: PlatformRefundType;
  status: PlatformRefundStatus;
  reason: string;
  amount: number;
  description: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

// ── Search ───────────────────────────────────────────────

export interface OrderSearchOptions {
  startTime?: Date;
  endTime?: Date;
  status?: PlatformOrderStatus[];
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ── Error ────────────────────────────────────────────────

export class PlatformApiError extends Error {
  constructor(
    message: string,
    public platform: IntegrationPlatform,
    public retryable: boolean,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "PlatformApiError";
  }
}
