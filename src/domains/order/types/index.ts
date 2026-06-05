/**
 * Order Domain — Type Definitions
 *
 * Platform-independent unified order model.
 * All order data flows through these types regardless of source platform.
 */

// ── Platform ─────────────────────────────────────────────

export type OrderPlatform = "taobao" | "pinduoduo" | "douyin" | "jd" | "manual";

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

/** Human-readable labels for each status. */
export const ORDER_STATUS_LABELS: Record<UnifiedOrderStatus, string> = {
  [UnifiedOrderStatus.PendingPayment]: "待支付",
  [UnifiedOrderStatus.Paid]: "已支付",
  [UnifiedOrderStatus.Shipped]: "已发货",
  [UnifiedOrderStatus.Delivered]: "已签收",
  [UnifiedOrderStatus.Completed]: "已完成",
  [UnifiedOrderStatus.Cancelled]: "已取消",
  [UnifiedOrderStatus.Refunding]: "退款中",
  [UnifiedOrderStatus.Refunded]: "已退款",
};

/** Statuses where the order is still active / not finalized. */
export const ACTIVE_ORDER_STATUSES: UnifiedOrderStatus[] = [
  UnifiedOrderStatus.PendingPayment,
  UnifiedOrderStatus.Paid,
  UnifiedOrderStatus.Shipped,
  UnifiedOrderStatus.Delivered,
];

// ── Core Entity ──────────────────────────────────────────

export interface UnifiedOrder {
  id: string;
  tenantId: string;
  platform: OrderPlatform;
  platformOrderId: string;
  parentOrderId: string | null;
  status: UnifiedOrderStatus;
  statusLabel: string;
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
  lastSyncedAt: Date;
}

export interface OrderReceiver {
  name: string;
  phoneLast4: string;
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
  platform: OrderPlatform;
  platformAfterSaleId: string;
  type: AfterSaleType;
  status: UnifiedAfterSaleStatus;
  reason: string;
  amount: number;
  description: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

// ── Create / Upsert Inputs ───────────────────────────────

export interface CreateOrderInput {
  tenantId: string;
  platform: OrderPlatform;
  platformOrderId: string;
  parentOrderId?: string;
  status: UnifiedOrderStatus;
  platformStatus: string;
  totalAmount: number;
  shippingFee?: number;
  discountAmount?: number;
  originalAmount?: number;
  buyerNick?: string;
  buyerNote?: string;
  receiver: OrderReceiver;
  items: CreateOrderItemInput[];
  orderCreatedAt?: Date;
  paidAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
  customerUserId?: string;
  platformData?: Record<string, unknown>;
}

export interface CreateOrderItemInput {
  platformSkuId: string;
  platformItemId: string;
  title: string;
  price: number;
  quantity: number;
  totalAmount?: number;
  skuAttributes?: Record<string, string>;
  imageUrl?: string;
  outerSkuId?: string;
  productId?: string;
}

export interface CreateAfterSaleInput {
  tenantId: string;
  orderId: string;
  platform: OrderPlatform;
  platformAfterSaleId: string;
  type: AfterSaleType;
  status: UnifiedAfterSaleStatus;
  reason?: string;
  amount: number;
  description?: string;
  afterSaleCreatedAt?: Date;
  platformData?: Record<string, unknown>;
}

// ── Search / Query ───────────────────────────────────────

export interface OrderSearchParams {
  tenantId: string;
  platforms?: OrderPlatform[];
  status?: UnifiedOrderStatus[];
  startTime?: Date;
  endTime?: Date;
  buyerNick?: string;
  keyword?: string;
  customerUserId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "orderCreatedAt" | "totalAmount" | "status";
  sortDir?: "asc" | "desc";
}

export interface OrderSummary {
  /** Total orders in the result set. */
  totalOrders: number;
  /** Orders grouped by status. */
  byStatus: Partial<Record<UnifiedOrderStatus, number>>;
  /** Orders grouped by platform. */
  byPlatform: Partial<Record<OrderPlatform, number>>;
  /** Total revenue across result set. */
  totalRevenue: number;
  /** Average order value. */
  avgOrderValue: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  summary?: OrderSummary;
}

// ── Linkage ──────────────────────────────────────────────

export interface OrderLinkRequest {
  conversationId: string;
  orderId: string;
}

export interface PlatformSkuMappingEntry {
  id: string;
  tenantId: string;
  platform: OrderPlatform;
  platformSkuId: string;
  productId: string;
}
