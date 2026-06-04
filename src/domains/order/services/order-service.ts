/**
 * Order Service — Unified order lookup.
 *
 * Implementation note: this is a PLAIN service stub. Platform adapters
 * (Taobao / Pinduoduo / Douyin / JD) are not yet implemented.
 * The service returns local OrderCache data only for now.
 */

import { OrderRepository } from "../repositories/order-repository";
import type {
  UnifiedOrder,
  UnifiedAfterSale,
  UnifiedOrderStatus,
  OrderPlatform,
  OrderSearchParams,
  PaginatedResult,
} from "../types";

export const OrderService = {
  // ── Single Order ─────────────────────────────────────

  async getOrder(
    tenantId: string,
    platform: OrderPlatform,
    orderId: string,
  ): Promise<UnifiedOrder | null> {
    return OrderRepository.findByPlatformId(tenantId, platform, orderId);
  },

  // ── Customer Orders ──────────────────────────────────

  async getCustomerOrders(
    tenantId: string,
    customerUserId: string,
    limit = 10,
  ): Promise<UnifiedOrder[]> {
    return OrderRepository.findByCustomer(tenantId, customerUserId, limit);
  },

  // ── Search ───────────────────────────────────────────

  async searchOrders(params: OrderSearchParams): Promise<PaginatedResult<UnifiedOrder>> {
    // In production: query all nominated platforms via adapters + merge results
    const items: UnifiedOrder[] = [];
    return {
      items,
      total: items.length,
      page: params.page,
      pageSize: params.pageSize,
      hasMore: false,
    };
  },

  // ── Status ───────────────────────────────────────────

  async getOrdersByStatus(
    tenantId: string,
    status: UnifiedOrderStatus[],
    limit = 20,
  ): Promise<UnifiedOrder[]> {
    return OrderRepository.findByStatus(tenantId, status, limit);
  },

  // ── After-Sales ──────────────────────────────────────

  async getAfterSales(
    _tenantId: string,
    _orderId: string,
  ): Promise<UnifiedAfterSale[]> {
    // Stub: requires platform adapter integration
    return [];
  },
};
