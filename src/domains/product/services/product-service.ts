/**
 * Product Service — Inventory queries + display formatting.
 * Delegates to existing InventoryService for backward compat.
 */

import { ProductRepository } from "../repositories/product-repository";
import { InventoryService } from "@/lib/services/inventory-service";
import type {
  ProductItem,
  ProductDisplayInfo,
  ProductRecommendation,
  InventoryQuery,
  InventoryResult,
  StockCheckResult,
  StockLabel,
} from "../types";

export const ProductService = {
  // ── Query (delegates to existing InventoryService) ────

  async queryProducts(
    tenantCtx: { tenantId: string },
    params: InventoryQuery,
  ): Promise<InventoryResult> {
    const result = await InventoryService.queryProducts(tenantCtx, params);
    return {
      products: result.products.map((p) => ({
        id: p.id,
        tenantId: tenantCtx.tenantId,
        sku: p.sku,
        name: p.name,
        description: p.description,
        price: parseFloat(p.price),
        stock: p.stock,
        category: p.category,
        imageUrls: p.imageUrls ?? [],
        attributes: {},
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      total: result.total,
    };
  },

  async checkStock(
    tenantCtx: { tenantId: string },
    sku: string,
  ): Promise<StockCheckResult | null> {
    return InventoryService.checkStock(tenantCtx, sku);
  },

  // ── Direct repository access ──────────────────────────

  async getProduct(tenantId: string, productId: string): Promise<ProductItem | null> {
    return ProductRepository.findById(tenantId, productId);
  },

  async getProductBySku(tenantId: string, sku: string): Promise<ProductItem | null> {
    return ProductRepository.findBySku(tenantId, sku);
  },

  async getAllProducts(tenantId: string, limit?: number): Promise<ProductItem[]> {
    return ProductRepository.findAll(tenantId, limit);
  },

  // ── Display Formatting ────────────────────────────────

  computeStockLabel(stock: number): StockLabel {
    if (stock <= 0) return "暂时缺货";
    if (stock <= 5) return "库存紧张";
    return "有货";
  },

  formatForDisplay(product: ProductItem, isImageMatched = false): ProductDisplayInfo {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      stockLabel: this.computeStockLabel(product.stock),
      category: product.category,
      imageUrls: product.imageUrls,
      isImageMatched,
    };
  },

  buildRecommendations(products: ProductItem[], count = 3): ProductRecommendation[] {
    return products.slice(0, count).map((p, i) => ({
      id: p.id,
      type: "product" as const,
      title: p.name,
      description: `¥${p.price} | ${this.computeStockLabel(p.stock)}`,
      score: 1 - i * 0.2,
      metadata: { category: p.category },
    }));
  },
};
