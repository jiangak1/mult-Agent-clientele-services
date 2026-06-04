/**
 * Order Repository — Data access for cached order data.
 * Provides a local query layer; delegates to platform adapters for live data.
 */

import { prisma } from "@/lib/auth/db-client";
import type { UnifiedOrder, UnifiedOrderStatus, OrderPlatform } from "../types";

export const OrderRepository = {
  async findByPlatformId(
    tenantId: string,
    platform: OrderPlatform,
    platformOrderId: string,
  ): Promise<UnifiedOrder | null> {
    const cached = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM "OrderCache"
       WHERE "tenantId" = $1 AND "platform" = $2 AND "platformOrderId" = $3
       LIMIT 1`,
      tenantId,
      platform,
      platformOrderId,
    );
    if (!cached || cached.length === 0) return null;
    return mapRowToOrder(cached[0] as Record<string, unknown>);
  },

  async findByStatus(
    tenantId: string,
    status: UnifiedOrderStatus[],
    limit = 20,
  ): Promise<UnifiedOrder[]> {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM "OrderCache"
       WHERE "tenantId" = $1 AND "status" = ANY($2)
       ORDER BY "orderCreatedAt" DESC
       LIMIT $3`,
      tenantId,
      status,
      limit,
    );
    return (rows as Record<string, unknown>[]).map(mapRowToOrder);
  },

  async findByPhoneHash(
    tenantId: string,
    phoneHash: string,
    phoneLast4: string,
    limit = 10,
  ): Promise<UnifiedOrder[]> {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM "OrderCache"
       WHERE "tenantId" = $1
         AND "receiverPhoneHash" = $2
         AND "receiverPhoneLast4" = $3
       ORDER BY "orderCreatedAt" DESC
       LIMIT $4`,
      tenantId,
      phoneHash,
      phoneLast4,
      limit,
    );
    return (rows as Record<string, unknown>[]).map(mapRowToOrder);
  },

  async findByCustomer(
    tenantId: string,
    customerUserId: string,
    limit = 10,
  ): Promise<UnifiedOrder[]> {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM "OrderCache"
       WHERE "tenantId" = $1 AND "customerUserId" = $2
       ORDER BY "orderCreatedAt" DESC
       LIMIT $3`,
      tenantId,
      customerUserId,
      limit,
    );
    return (rows as Record<string, unknown>[]).map(mapRowToOrder);
  },
};

// ── Row Mapper ────────────────────────────────────────────

function mapRowToOrder(row: Record<string, unknown>): UnifiedOrder {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    platform: row.platform as OrderPlatform,
    platformOrderId: row.platformOrderId as string,
    parentOrderId: row.parentOrderId as string | null,
    status: row.status as UnifiedOrderStatus,
    platformStatus: row.platformStatus as string,
    totalAmount: Number(row.totalAmount),
    shippingFee: Number(row.shippingFee ?? 0),
    discountAmount: Number(row.discountAmount ?? 0),
    originalAmount: Number(row.originalAmount ?? 0),
    buyerNick: row.buyerNick as string,
    buyerNote: (row.buyerNote as string) ?? null,
    receiver: {
      name: (row.receiverName as string) ?? "",
      phone: "",
      province: (row.receiverProvince as string) ?? "",
      city: (row.receiverCity as string) ?? "",
      district: (row.receiverDistrict as string) ?? "",
      address: (row.receiverAddress as string) ?? "",
    },
    items: [],
    orderCreatedAt: row.orderCreatedAt as Date,
    paidAt: (row.paidAt as Date) ?? null,
    shippedAt: (row.shippedAt as Date) ?? null,
    deliveredAt: (row.deliveredAt as Date) ?? null,
    completedAt: (row.completedAt as Date) ?? null,
    cancelledAt: (row.cancelledAt as Date) ?? null,
    afterSales: [],
  };
}
