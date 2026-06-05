/**
 * Order Service — SINGLE ENTRY POINT for all order operations.
 *
 * GUARANTEE: every module that needs order data MUST call OrderService.
 * No direct OrderRepository / Prisma calls for order tables.
 *
 * Currently: local OrderCache only (no platform API integration).
 * Future: platform adapters will be called from within these methods.
 */

import { OrderRepository } from "../repositories/order-repository";
import type {
  UnifiedOrder,
  UnifiedAfterSale,
  UnifiedOrderStatus,
  OrderPlatform,
  OrderSearchParams,
  PaginatedResult,
  OrderSummary,
  CreateOrderInput,
  CreateAfterSaleInput,
  PlatformSkuMappingEntry,
} from "../types";
import { ORDER_STATUS_LABELS } from "../types";

export const OrderService = {
  // ============================================================
  // READ — Single Order
  // ============================================================

  /** Get a single order by internal ID (with items + afterSales). */
  async getOrder(tenantId: string, orderId: string): Promise<UnifiedOrder | null> {
    return OrderRepository.findById(tenantId, orderId);
  },

  /** Get a single order by platform order number. */
  async getOrderByPlatformId(
    tenantId: string,
    platform: OrderPlatform,
    platformOrderId: string,
  ): Promise<UnifiedOrder | null> {
    return OrderRepository.findByPlatformId(tenantId, platform, platformOrderId);
  },

  /** Batch-load orders by internal IDs. */
  async getOrdersByIds(tenantId: string, orderIds: string[]): Promise<UnifiedOrder[]> {
    return OrderRepository.findByIds(tenantId, orderIds);
  },

  // ============================================================
  // READ — Query
  // ============================================================

  /** Search orders with filters + pagination. */
  async searchOrders(params: OrderSearchParams): Promise<PaginatedResult<UnifiedOrder>> {
    const { rows, total } = await OrderRepository.search(params);
    const summary = await OrderRepository.computeSummary({
      tenantId: params.tenantId,
      status: params.status,
      startTime: params.startTime,
      endTime: params.endTime,
    });

    return {
      items: rows.map((r) => ({
        id: r.id as string,
        tenantId: r.tenantId as string,
        platform: r.platform as OrderPlatform,
        platformOrderId: r.platformOrderId as string,
        parentOrderId: (r.parentOrderId as string) ?? null,
        status: r.status as UnifiedOrderStatus,
        statusLabel: ORDER_STATUS_LABELS[r.status as UnifiedOrderStatus] ?? r.status,
        platformStatus: r.platformStatus as string,
        totalAmount: Number(r.totalAmount),
        shippingFee: Number(r.shippingFee ?? 0),
        discountAmount: Number(r.discountAmount ?? 0),
        originalAmount: Number(r.originalAmount ?? 0),
        buyerNick: (r.buyerNick as string) ?? "",
        buyerNote: (r.buyerNote as string) ?? null,
        receiver: {
          name: (r.receiverName as string) ?? "",
          phoneLast4: (r.receiverPhoneLast4 as string) ?? "",
          province: (r.receiverProvince as string) ?? "",
          city: (r.receiverCity as string) ?? "",
          district: (r.receiverDistrict as string) ?? "",
          address: (r.receiverAddress as string) ?? "",
        },
        items: [],
        orderCreatedAt: r.orderCreatedAt as Date,
        paidAt: (r.paidAt as Date) ?? null,
        shippedAt: (r.shippedAt as Date) ?? null,
        deliveredAt: (r.deliveredAt as Date) ?? null,
        completedAt: (r.completedAt as Date) ?? null,
        cancelledAt: (r.cancelledAt as Date) ?? null,
        afterSales: [],
        lastSyncedAt: r.lastSyncedAt as Date,
      })),
      total,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      hasMore: (params.page ?? 1) * (params.pageSize ?? 20) < total,
      summary,
    };
  },

  /** Get orders for a specific customer. */
  async getCustomerOrders(
    tenantId: string,
    customerUserId: string,
    limit?: number,
  ): Promise<UnifiedOrder[]> {
    return OrderRepository.findByCustomer(tenantId, customerUserId, limit);
  },

  /** Get orders by status. */
  async getOrdersByStatus(
    tenantId: string,
    status: UnifiedOrderStatus[],
    limit?: number,
  ): Promise<UnifiedOrder[]> {
    return OrderRepository.findByStatus(tenantId, status, limit);
  },

  /** Find orders linked to a conversation/ticket. */
  async getOrdersForConversation(conversationId: string): Promise<UnifiedOrder[]> {
    return OrderRepository.getConversationOrders(conversationId);
  },

  // ============================================================
  // WRITE — Upsert (sync / manual entry)
  // ============================================================

  /** Create or update an order. Idempotent by platform + platformOrderId. */
  async upsertOrder(input: CreateOrderInput): Promise<string> {
    return OrderRepository.upsert(input);
  },

  /** Update order status (e.g., from webhook or manual review). */
  async updateOrderStatus(
    tenantId: string,
    orderId: string,
    status: UnifiedOrderStatus,
    platformStatus: string,
    timestamps?: Parameters<typeof OrderRepository.updateStatus>[4],
  ): Promise<void> {
    return OrderRepository.updateStatus(tenantId, orderId, status, platformStatus, timestamps);
  },

  // ============================================================
  // After-Sale
  // ============================================================

  /** Record an after-sale event (refund/return/exchange). */
  async upsertAfterSale(input: CreateAfterSaleInput): Promise<void> {
    return OrderRepository.upsertAfterSale(input);
  },

  /** Get after-sale records for an order. */
  async getAfterSales(tenantId: string, orderId: string): Promise<UnifiedAfterSale[]> {
    const order = await OrderRepository.findById(tenantId, orderId);
    return order?.afterSales ?? [];
  },

  // ============================================================
  // Linkage — Order ↔ Conversation
  // ============================================================

  /** Link an order to a conversation (ticket). */
  async linkToConversation(conversationId: string, orderId: string): Promise<void> {
    return OrderRepository.linkToConversation(conversationId, orderId);
  },

  // ============================================================
  // SKU Mapping — Platform SKU ↔ Local Product
  // ============================================================

  /** Map a platform's SKU to a local product. */
  async mapPlatformSku(
    tenantId: string,
    platform: OrderPlatform,
    platformSkuId: string,
    productId: string,
  ): Promise<void> {
    return OrderRepository.mapSku(tenantId, platform, platformSkuId, productId);
  },

  /** Look up the local product for a platform SKU. */
  async resolvePlatformSku(
    tenantId: string,
    platform: OrderPlatform,
    platformSkuId: string,
  ): Promise<PlatformSkuMappingEntry | null> {
    return OrderRepository.getSkuMapping(tenantId, platform, platformSkuId);
  },

  // ============================================================
  // Aggregation
  // ============================================================

  /** Compute summary statistics for a set of orders. */
  async computeSummary(params: {
    tenantId: string;
    status?: UnifiedOrderStatus[];
    startTime?: Date;
    endTime?: Date;
  }): Promise<OrderSummary> {
    return OrderRepository.computeSummary(params);
  },
};
