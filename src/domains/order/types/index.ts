/**
 * Order Domain — Types
 *
 * Platform-independent unified order representation.
 * Maps to OrderCache in the planned schema.
 */

// ── Platform ─────────────────────────────────────────────

export type OrderPlatform = "taobao" | "pinduoduo" | "douyin" | "jd";

// ── Order Status ─────────────────────────────────────────

export enum UnifiedOrderStatus {
  PendingPayment = "pending_payment",
  Paid = "paid",
  Shipped = "shipped",
  Delivered = "delivered",
  Completed = "completed",
  Cancelled = "cancelled",
  Refunding = "refunding",
  Refunded = "refunded",
}

// ── Core Entity ──────────────────────────────────────────

export interface UnifiedOrder {
  id: string;
  tenantId: string;
  platform: OrderPlatform;
  platformOrderId: string;
  parentOrderId: string | null;
  status: UnifiedOrderStatus;
  platformStatus: string;
  totalAmount: number;
  shippingFee: number;
  discountAmount: number;
  originalAmount: number;
  buyerNick: string;
  buyerNote: string | null;
  receiver: OrderReceiver;
  items: UnifiedOrderItem[];
  orderCreatedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  afterSales: UnifiedAfterSale[];
}

export interface OrderReceiver {
  name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  address: string;
  zipCode?: string;
}

export interface UnifiedOrderItem {
  id: string;
  platformSkuId: string;
  platformItemId: string;
  title: string;
  price: number;
  quantity: number;
  totalAmount: number;
  imageUrl: string | null;
  attributes: Record<string, string>;
  outerSkuId: string | null;
  productId: string | null;
}

// ── After-Sale ───────────────────────────────────────────

export type AfterSaleType = "refund" | "return" | "exchange";

export enum UnifiedAfterSaleStatus {
  Pending = "pending",
  Approved = "approved",
  Rejected = "rejected",
  BuyerShipped = "buyer_shipped",
  Received = "received",
  Refunding = "refunding",
  Completed = "completed",
  Closed = "closed",
}

export interface UnifiedAfterSale {
  id: string;
  platformAfterSaleId: string;
  type: AfterSaleType;
  status: UnifiedAfterSaleStatus;
  reason: string;
  amount: number;
  description: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

// ── Search ───────────────────────────────────────────────

export interface OrderSearchParams {
  tenantId: string;
  platforms?: OrderPlatform[];
  status?: UnifiedOrderStatus[];
  startTime: Date;
  endTime: Date;
  buyerNick?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
