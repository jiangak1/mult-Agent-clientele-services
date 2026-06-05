/**
 * Order Repository — Data access layer for OrderCache + related tables.
 *
 * ALL order data access MUST go through this repository.
 * No other module may query OrderCache / OrderItemCache / AfterSaleCache directly.
 */

import { prisma } from "@/lib/auth/db-client";
import { createHash } from "crypto";
import type {
  UnifiedOrder,
  UnifiedOrderItem,
  UnifiedAfterSale,
  UnifiedOrderStatus,
  OrderPlatform,
  OrderReceiver,
  OrderSearchParams,
  PaginatedResult,
  OrderSummary,
  CreateOrderInput,
  CreateAfterSaleInput,
  AfterSaleType,
  UnifiedAfterSaleStatus,
  PlatformSkuMappingEntry,
} from "../types";
import { ORDER_STATUS_LABELS, ACTIVE_ORDER_STATUSES } from "../types";

// ── Helpers ───────────────────────────────────────────────

function hashPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

function last4(phone: string): string {
  return phone.slice(-4);
}

function mapRow(row: Record<string, unknown>): UnifiedOrder {
  const status = row.status as UnifiedOrderStatus;
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    platform: row.platform as OrderPlatform,
    platformOrderId: row.platformOrderId as string,
    parentOrderId: (row.parentOrderId as string) ?? null,
    status,
    statusLabel: ORDER_STATUS_LABELS[status] ?? status,
    platformStatus: row.platformStatus as string,
    totalAmount: Number(row.totalAmount),
    shippingFee: Number(row.shippingFee ?? 0),
    discountAmount: Number(row.discountAmount ?? 0),
    originalAmount: Number(row.originalAmount ?? 0),
    buyerNick: (row.buyerNick as string) ?? "",
    buyerNote: (row.buyerNote as string) ?? null,
    receiver: {
      name: (row.receiverName as string) ?? "",
      phoneLast4: (row.receiverPhoneLast4 as string) ?? "",
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
    lastSyncedAt: row.lastSyncedAt as Date,
  };
}

function mapItemRow(row: Record<string, unknown>): UnifiedOrderItem {
  return {
    id: row.id as string,
    platformSkuId: row.platformSkuId as string,
    platformItemId: row.platformItemId as string,
    title: row.title as string,
    price: Number(row.price),
    quantity: row.quantity as number,
    totalAmount: Number(row.totalAmount),
    imageUrl: (row.imageUrl as string) ?? null,
    attributes: (row.skuAttributes as Record<string, string>) ?? {},
    outerSkuId: (row.outerSkuId as string) ?? null,
    productId: (row.productId as string) ?? null,
  };
}

function mapAfterSaleRow(row: Record<string, unknown>): UnifiedAfterSale {
  return {
    id: row.id as string,
    platform: row.platform as OrderPlatform,
    platformAfterSaleId: row.platformAfterSaleId as string,
    type: row.type as AfterSaleType,
    status: row.status as UnifiedAfterSaleStatus,
    reason: (row.reason as string) ?? "",
    amount: Number(row.amount),
    description: (row.description as string) ?? "",
    createdAt: row.afterSaleCreatedAt as Date,
    resolvedAt: (row.resolvedAt as Date) ?? null,
  };
}

// ── Repository ────────────────────────────────────────────

export const OrderRepository = {
  // ── Single-order queries ──────────────────────────────

  async findById(tenantId: string, orderId: string): Promise<UnifiedOrder | null> {
    const row = await prisma.orderCache.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!row) return null;

    const [items, afterSales] = await Promise.all([
      prisma.orderItemCache.findMany({ where: { orderId } }),
      prisma.afterSaleCache.findMany({ where: { orderId } }),
    ]);

    const order = mapRow(row as unknown as Record<string, unknown>);
    order.items = (items as unknown as Record<string, unknown>[]).map(mapItemRow);
    order.afterSales = (afterSales as unknown as Record<string, unknown>[]).map(mapAfterSaleRow);
    return order;
  },

  async findByPlatformId(
    tenantId: string,
    platform: OrderPlatform,
    platformOrderId: string,
  ): Promise<UnifiedOrder | null> {
    const row = await prisma.orderCache.findUnique({
      where: { tenantId_platform_platformOrderId: { tenantId, platform, platformOrderId } },
    });
    if (!row) return null;
    return OrderRepository.findById(tenantId, row.id);
  },

  // ── Batch queries ─────────────────────────────────────

  async findByIds(tenantId: string, orderIds: string[]): Promise<UnifiedOrder[]> {
    const rows = await prisma.orderCache.findMany({
      where: { id: { in: orderIds }, tenantId },
    });
    return Promise.all(
      (rows as unknown as Record<string, unknown>[]).map(async (r) => {
        const order = mapRow(r);
        const items = await prisma.orderItemCache.findMany({ where: { orderId: order.id } });
        order.items = (items as unknown as Record<string, unknown>[]).map(mapItemRow);
        return order;
      }),
    );
  },

  async findByStatus(
    tenantId: string,
    status: UnifiedOrderStatus[],
    limit = 20,
  ): Promise<UnifiedOrder[]> {
    const rows = await prisma.orderCache.findMany({
      where: { tenantId, status: { in: status } },
      orderBy: { orderCreatedAt: "desc" },
      take: limit,
    });
    return (rows as unknown as Record<string, unknown>[]).map(mapRow);
  },

  async findByCustomer(
    tenantId: string,
    customerUserId: string,
    limit = 10,
  ): Promise<UnifiedOrder[]> {
    const rows = await prisma.orderCache.findMany({
      where: { tenantId, customerUserId },
      orderBy: { orderCreatedAt: "desc" },
      take: limit,
    });
    return (rows as unknown as Record<string, unknown>[]).map(mapRow);
  },

  async findByPhone(
    tenantId: string,
    phone: string,
    limit = 10,
  ): Promise<UnifiedOrder[]> {
    const phoneHash = hashPhone(phone);
    const phoneLast4 = last4(phone);
    const rows = await prisma.orderCache.findMany({
      where: { tenantId, receiverPhoneHash: phoneHash, receiverPhoneLast4: phoneLast4 },
      orderBy: { orderCreatedAt: "desc" },
      take: limit,
    });
    return (rows as unknown as Record<string, unknown>[]).map(mapRow);
  },

  // ── Search ────────────────────────────────────────────

  async search(params: OrderSearchParams): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const where: Record<string, unknown> = { tenantId: params.tenantId };
    if (params.platforms?.length) where.platform = { in: params.platforms };
    if (params.status?.length) where.status = { in: params.status };
    if (params.buyerNick) where.buyerNick = { contains: params.buyerNick, mode: "insensitive" };
    if (params.customerUserId) where.customerUserId = params.customerUserId;
    if (params.startTime || params.endTime) {
      const createdAt: Record<string, Date> = {};
      if (params.startTime) createdAt.gte = params.startTime;
      if (params.endTime) createdAt.lte = params.endTime;
      where.orderCreatedAt = createdAt;
    }

    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const sortBy = params.sortBy ?? "orderCreatedAt";
    const sortDir = params.sortDir ?? "desc";

    const [rows, total] = await Promise.all([
      prisma.orderCache.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.orderCache.count({ where }),
    ]);

    return { rows: rows as unknown as Record<string, unknown>[], total };
  },

  // ── Write ─────────────────────────────────────────────

  async upsert(input: CreateOrderInput): Promise<string> {
    const phoneHash = input.receiver?.phoneLast4
      ? hashPhone(input.receiver.phoneLast4)
      : null;

    const order = await prisma.orderCache.upsert({
      where: {
        tenantId_platform_platformOrderId: {
          tenantId: input.tenantId,
          platform: input.platform,
          platformOrderId: input.platformOrderId,
        },
      },
      create: {
        tenantId: input.tenantId,
        platform: input.platform,
        platformOrderId: input.platformOrderId,
        parentOrderId: input.parentOrderId ?? null,
        status: input.status,
        platformStatus: input.platformStatus,
        totalAmount: input.totalAmount,
        shippingFee: input.shippingFee ?? 0,
        discountAmount: input.discountAmount ?? 0,
        originalAmount: input.originalAmount ?? 0,
        buyerNick: input.buyerNick ?? null,
        buyerNote: input.buyerNote ?? null,
        receiverName: input.receiver?.name ?? null,
        receiverPhoneHash: phoneHash,
        receiverPhoneLast4: input.receiver?.phoneLast4 ?? null,
        receiverProvince: input.receiver?.province ?? null,
        receiverCity: input.receiver?.city ?? null,
        receiverDistrict: input.receiver?.district ?? null,
        receiverAddress: input.receiver?.address ?? null,
        orderCreatedAt: input.orderCreatedAt ?? new Date(),
        paidAt: input.paidAt ?? null,
        shippedAt: input.shippedAt ?? null,
        deliveredAt: input.deliveredAt ?? null,
        customerUserId: input.customerUserId ?? null,
        platformData: input.platformData ?? {},
      },
      update: {
        status: input.status,
        platformStatus: input.platformStatus,
        totalAmount: input.totalAmount,
        shippingFee: input.shippingFee ?? 0,
        discountAmount: input.discountAmount ?? 0,
        customerUserId: input.customerUserId ?? undefined,
        platformData: input.platformData ?? undefined,
      },
    });

    // Upsert items (delete + recreate for simplicity)
    if (input.items?.length) {
      await prisma.orderItemCache.deleteMany({ where: { orderId: order.id } });
      await prisma.orderItemCache.createMany({
        data: input.items.map((item) => ({
          orderId: order.id,
          platformSkuId: item.platformSkuId,
          platformItemId: item.platformItemId,
          title: item.title,
          price: item.price,
          quantity: item.quantity,
          totalAmount: item.totalAmount ?? item.price * item.quantity,
          skuAttributes: item.skuAttributes ?? {},
          imageUrl: item.imageUrl ?? null,
          outerSkuId: item.outerSkuId ?? null,
          productId: item.productId ?? null,
        })),
      });
    }

    return order.id;
  },

  async updateStatus(
    tenantId: string,
    orderId: string,
    status: UnifiedOrderStatus,
    platformStatus: string,
    timestamps?: { paidAt?: Date; shippedAt?: Date; deliveredAt?: Date; completedAt?: Date; cancelledAt?: Date },
  ): Promise<void> {
    const data: Record<string, unknown> = { status, platformStatus };
    if (timestamps?.paidAt) data.paidAt = timestamps.paidAt;
    if (timestamps?.shippedAt) data.shippedAt = timestamps.shippedAt;
    if (timestamps?.deliveredAt) data.deliveredAt = timestamps.deliveredAt;
    if (timestamps?.completedAt) data.completedAt = timestamps.completedAt;
    if (timestamps?.cancelledAt) data.cancelledAt = timestamps.cancelledAt;

    await prisma.orderCache.updateMany({
      where: { id: orderId, tenantId },
      data,
    });
  },

  // ── After-Sale ────────────────────────────────────────

  async upsertAfterSale(input: CreateAfterSaleInput): Promise<void> {
    await prisma.afterSaleCache.upsert({
      where: {
        tenantId_platform_platformAfterSaleId: {
          tenantId: input.tenantId,
          platform: input.platform,
          platformAfterSaleId: input.platformAfterSaleId,
        },
      },
      create: {
        tenantId: input.tenantId,
        orderId: input.orderId,
        platform: input.platform,
        platformAfterSaleId: input.platformAfterSaleId,
        type: input.type,
        status: input.status,
        reason: input.reason ?? null,
        amount: input.amount,
        description: input.description ?? null,
        afterSaleCreatedAt: input.afterSaleCreatedAt ?? new Date(),
        platformData: input.platformData ?? {},
      },
      update: {
        status: input.status,
        amount: input.amount,
        resolvedAt: input.status === "completed" || input.status === "closed" ? new Date() : undefined,
        platformData: input.platformData ?? undefined,
      },
    });
  },

  // ── Linkage ───────────────────────────────────────────

  async linkToConversation(conversationId: string, orderId: string): Promise<void> {
    await prisma.conversationOrder.upsert({
      where: { conversationId_orderId: { conversationId, orderId } },
      create: { conversationId, orderId },
      update: {},
    });
  },

  async getConversationOrders(conversationId: string): Promise<UnifiedOrder[]> {
    const links = await prisma.conversationOrder.findMany({
      where: { conversationId },
      select: { orderId: true },
    });
    if (!links.length) return [];
    return OrderRepository.findByIds(
      "", // tenantId not needed — ids are globally unique
      links.map((l) => l.orderId),
    );
  },

  // ── SKU Mapping ───────────────────────────────────────

  async mapSku(
    tenantId: string,
    platform: OrderPlatform,
    platformSkuId: string,
    productId: string,
  ): Promise<void> {
    await prisma.platformSkuMapping.upsert({
      where: { tenantId_platform_platformSkuId: { tenantId, platform, platformSkuId } },
      create: { tenantId, platform, platformSkuId, productId },
      update: { productId },
    });
  },

  async getSkuMapping(
    tenantId: string,
    platform: OrderPlatform,
    platformSkuId: string,
  ): Promise<PlatformSkuMappingEntry | null> {
    const row = await prisma.platformSkuMapping.findUnique({
      where: { tenantId_platform_platformSkuId: { tenantId, platform, platformSkuId } },
    });
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      platform: row.platform as OrderPlatform,
      platformSkuId: row.platformSkuId,
      productId: row.productId,
    };
  },

  // ── Aggregation ───────────────────────────────────────

  async computeSummary(params: { tenantId: string; status?: UnifiedOrderStatus[]; startTime?: Date; endTime?: Date }): Promise<OrderSummary> {
    const where: Record<string, unknown> = { tenantId: params.tenantId };
    if (params.status?.length) where.status = { in: params.status };
    if (params.startTime || params.endTime) {
      const createdAt: Record<string, Date> = {};
      if (params.startTime) createdAt.gte = params.startTime;
      if (params.endTime) createdAt.lte = params.endTime;
      where.orderCreatedAt = createdAt;
    }

    const rows = await prisma.orderCache.findMany({
      where,
      select: { status: true, platform: true, totalAmount: true },
    });

    const summary: OrderSummary = {
      totalOrders: rows.length,
      byStatus: {},
      byPlatform: {},
      totalRevenue: 0,
      avgOrderValue: 0,
    };

    for (const r of rows) {
      const s = r.status as UnifiedOrderStatus;
      const p = r.platform as OrderPlatform;
      const amt = Number(r.totalAmount);

      summary.byStatus[s] = (summary.byStatus[s] ?? 0) + 1;
      summary.byPlatform[p] = (summary.byPlatform[p] ?? 0) + 1;
      summary.totalRevenue += amt;
    }

    summary.avgOrderValue = rows.length > 0 ? summary.totalRevenue / rows.length : 0;
    return summary;
  },
};
