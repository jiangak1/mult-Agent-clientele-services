/**
 * Product Domain — Types
 *
 * Represents a product in the inventory catalog.
 * Maps to Product in the existing Prisma schema.
 */

// ── Core Entity ──────────────────────────────────────────

export interface ProductItem {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  category: string | null;
  imageUrls: string[];
  attributes: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Stock Label (abstracted for customer display) ────────

export type StockLabel = "有货" | "库存紧张" | "暂时缺货";

export interface ProductDisplayInfo {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stockLabel: StockLabel;
  category: string | null;
  imageUrls: string[];
  isImageMatched: boolean;
}

// ── Inventory ────────────────────────────────────────────

export interface InventoryQuery {
  sku?: string;
  category?: string;
  keyword?: string;
  minStock?: number;
  limit?: number;
}

export interface InventoryResult {
  products: ProductItem[];
  total: number;
}

export interface StockCheckResult {
  available: boolean;
  stock: number;
  productName: string;
}

// ── Recommendation ───────────────────────────────────────

export interface ProductRecommendation {
  id: string;
  type: "product" | "solution" | "faq";
  title: string;
  description: string;
  score: number;
  metadata: Record<string, unknown>;
}
