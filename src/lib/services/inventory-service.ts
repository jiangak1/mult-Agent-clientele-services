import { prisma, withTenant } from "@/lib/auth/db-client";
import { redis, cacheKey, cacheGet, cacheSet } from "@/lib/utils/redis";
import type { TenantContext } from "@/types";

export interface InventoryQuery {
  sku?: string;
  category?: string;
  keyword?: string;
  minStock?: number;
  limit?: number;
}

export interface InventoryResult {
  products: Array<{
    id: string;
    sku: string;
    name: string;
    description: string | null;
    price: string;
    stock: number;
    category: string | null;
    imageUrls: string[];
  }>;
  total: number;
}

export class InventoryService {
  /**
   * Query inventory for a tenant
   */
  static async queryProducts(tenant: TenantContext, query: InventoryQuery): Promise<InventoryResult> {
    const cacheK = cacheKey(tenant.tenantId, "inventory", JSON.stringify(query));
    const cached = await cacheGet<InventoryResult>(cacheK);
    if (cached) return cached;

    const filters: Parameters<typeof prisma.product.findMany>[0] = {
      take: query.limit ?? 20,
      orderBy: { updatedAt: "desc" },
    };

    const where: Record<string, unknown> = { isActive: true };

    if (query.sku) where.sku = query.sku;
    if (query.category) where.category = query.category;
    if (query.keyword) {
      // Split long queries into search terms, filter out short/stop words
      const terms = query.keyword
        .split(/[\s,，。.!！?？;；:：、]+/)
        .map((t: string) => t.trim())
        .filter((t: string) => t.length >= 2)
        .slice(0, 8); // cap to avoid huge queries
      if (terms.length > 0) {
        where.OR = terms.flatMap((term: string) => [
          { name: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
        ]);
      }
    }
    if (query.minStock !== undefined) {
      where.stock = { gte: query.minStock };
    }

    filters.where = where;

    const [products, total] = await withTenant(tenant, async (tx) =>
      Promise.all([
        tx.product.findMany(filters),
        tx.product.count({ where: where as never }),
      ]),
    );

    const result: InventoryResult = {
      products: products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        price: p.price.toString(),
        stock: p.stock,
        category: p.category,
        imageUrls: (p as { imageUrls?: string[] }).imageUrls ?? [],
      })),
      total,
    };

    await cacheSet(cacheK, result, 60);
    return result;
  }

  /**
   * Check stock availability for a specific product
   */
  static async checkStock(tenant: TenantContext, sku: string): Promise<{
    available: boolean;
    stock: number;
    productName: string;
  } | null> {
    return withTenant(tenant, async (tx) => {
      const product = await tx.product.findUnique({
        where: { tenantId_sku: { tenantId: tenant.tenantId, sku } },
      });

      if (!product) return null;
      return {
        available: product.stock > 0,
        stock: product.stock,
        productName: product.name,
      };
    });
  }
}
