/**
 * AdapterFactory — creates and caches platform adapters.
 *
 * Currently: all adapters are Mock.
 * Future: detect credentials → if real API keys present → use real adapter.
 *
 * Usage:
 *   const factory = AdapterFactory.getInstance();
 *   const taobao = factory.get("taobao");
 *   const order = await taobao.getOrder("TB-xxx");
 */

import type { PlatformAdapter } from "./core/adapter";
import type { IntegrationPlatform } from "./core/types";
import { TaobaoAdapter } from "./taobao";
import { PinduoduoAdapter } from "./pdd";

export class AdapterFactory {
  private static instance: AdapterFactory;
  private adapters = new Map<IntegrationPlatform, PlatformAdapter>();

  private constructor() {
    // Register all available adapters
    this.register(new TaobaoAdapter());
    this.register(new PinduoduoAdapter());
  }

  static getInstance(): AdapterFactory {
    if (!AdapterFactory.instance) {
      AdapterFactory.instance = new AdapterFactory();
    }
    return AdapterFactory.instance;
  }

  /** Register a custom adapter (e.g., for testing or new platform). */
  register(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  /** Get an adapter by platform name. */
  get(platform: IntegrationPlatform): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`No adapter registered for platform: ${platform}`);
    }
    return adapter;
  }

  /** Get all registered adapters. */
  getAll(): PlatformAdapter[] {
    return Array.from(this.adapters.values());
  }

  /** Get all adapters that are healthy. */
  async getHealthy(): Promise<PlatformAdapter[]> {
    const results = await Promise.all(
      this.getAll().map(async (a) => {
        try {
          const latency = await a.healthCheck();
          return { adapter: a, healthy: latency > 0 };
        } catch {
          return { adapter: a, healthy: false };
        }
      }),
    );
    return results.filter((r) => r.healthy).map((r) => r.adapter);
  }

  /** Check health of all adapters. */
  async healthReport(): Promise<Array<{ platform: string; healthy: boolean; latencyMs: number }>> {
    return Promise.all(
      this.getAll().map(async (a) => {
        try {
          const latencyMs = await a.healthCheck();
          return { platform: a.platform, healthy: true, latencyMs };
        } catch {
          return { platform: a.platform, healthy: false, latencyMs: -1 };
        }
      }),
    );
  }
}

/** Convenience: get the singleton instance. */
export function getAdapterFactory(): AdapterFactory {
  return AdapterFactory.getInstance();
}

/** Convenience: get a specific platform adapter. */
export function getPlatformAdapter(platform: IntegrationPlatform): PlatformAdapter {
  return AdapterFactory.getInstance().get(platform);
}
