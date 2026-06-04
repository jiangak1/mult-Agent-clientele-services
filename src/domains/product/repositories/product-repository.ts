/**
 * Product Repository — Data access for Product inventory.
 * Wraps existing Prisma queries with tenant-aware filtering.
 */

import { prisma, withTenant } from "@/lib/auth/db-client";
import type { ProductItem, InventoryQuery, InventoryResult } from "../types";

export const ProductRepository = {
  async findById(tenantId: string, productId: string): Promise<ProductItem | null> {
    const row = await prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!row) return null;
    return mapProduct(row as unknown as Record<string, unknown>);
  },

  async findBySku(tenantId: string, sku: string): Promise<ProductItem | null> {
    const row = await prisma.product.findUnique({
      where: { tenantId_sku: { tenantId, sku } },
    });
    if (!row) return null;
    return mapProduct(row as unknown as Record<string, unknown>);
  },

  async query(
    tenantCtx: { tenantId: string },
    params: InventoryQuery,
  ): Promise<InventoryResult> {
    return withTenant(tenantCtx, async (tx) => {
      const where: Record<string, unknown> = { isActive: true };
      if (params.sku) where.sku = params.sku;
      if (params.category) where.category = params.category;
      if (params.keyword) {
        const terms = params.keyword
          .split(/[\s,，。.!！?？;；:：、]+/)
          .map((t: string) => t.trim())
          .filter((t: string) => t.length >= 2)
          .slice(0, 8);
        if (terms.length > 0) {
          where.OR = terms.flatMap((term) => [
            { name: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
          ]);
        }
      }
      if (params.minStock !== undefined) where.stock = { gte: params.minStock };

      const [rows, total] = await Promise.all([
        tx.product.findMany({
          where,
          take: params.limit ?? 20,
          orderBy: { updatedAt: "desc" },
        }),
        tx.product.count({ where }),
      ]);

      return {
        products: (rows as unknown as Record<string, unknown>[]).map(mapProduct),
        total,
      };
    });
  },

  async findAll(tenantId: string, limit = 20): Promise<ProductItem[]> {
    const rows = await prisma.product.findMany({
      where: { tenantId, isActive: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return (rows as unknown as Record<string, unknown>[]).map(mapProduct);
  },
};

function mapProduct(row: Record<string, unknown>): ProductItem {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    sku: row.sku as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    price: Number(row.price),
    stock: row.stock as number,
    category: (row.category as string) ?? null,
    imageUrls: (row.imageUrls as string[]) ?? [],
    attributes: (row.attributes as Record<string, unknown>) ?? {},
    isActive: (row.isActive as boolean) ?? true,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}
