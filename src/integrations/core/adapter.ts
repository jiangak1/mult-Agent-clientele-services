/**
 * Platform Adapter Interface
 *
 * Every platform integration (Taobao, PDD, Douyin, JD) implements this interface.
 * Mock adapters return simulated data. Real adapters call platform APIs.
 *
 * To swap: change the adapter instance returned by AdapterFactory.
 * No other code changes needed.
 */

import type {
  IntegrationPlatform,
  PlatformOrder,
  PlatformProduct,
  PlatformRefund,
  OrderSearchOptions,
  PaginatedResult,
} from "./types";

/**
 * PlatformAdapter — the single contract for all platform integrations.
 *
 * Future real implementations:
 *   class TaobaoAdapter implements PlatformAdapter { ... }
 *   class PinduoduoAdapter implements PlatformAdapter { ... }
 */
export interface PlatformAdapter {
  /** Platform identifier. */
  readonly platform: IntegrationPlatform;

  /** Human-readable platform name. */
  readonly displayName: string;

  /** Whether this adapter connects to real APIs or returns mock data. */
  readonly isMock: boolean;

  // ── Orders ───────────────────────────────────────────

  /** Get a single order by platform order ID. */
  getOrder(orderId: string): Promise<PlatformOrder | null>;

  /** Search orders by time range / status. */
  searchOrders(options: OrderSearchOptions): Promise<PaginatedResult<PlatformOrder>>;

  /** Get orders by buyer phone (for customer lookup). */
  getOrdersByPhone(phone: string, limit?: number): Promise<PlatformOrder[]>;

  // ── Products ─────────────────────────────────────────

  /** Get a single product by platform product ID. */
  getProduct(productId: string): Promise<PlatformProduct | null>;

  /** Search products by keyword. */
  searchProducts(keyword: string, limit?: number): Promise<PlatformProduct[]>;

  // ── Refunds ──────────────────────────────────────────

  /** Get refunds for an order. */
  getRefunds(orderId: string): Promise<PlatformRefund[]>;

  /** Get a single refund by platform refund ID. */
  getRefund(refundId: string): Promise<PlatformRefund | null>;

  // ── Health ───────────────────────────────────────────

  /** Check platform API connectivity. Returns latency in ms, or -1 if down. */
  healthCheck(): Promise<number>;
}
