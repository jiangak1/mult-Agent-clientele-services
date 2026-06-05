/**
 * Integrations — Platform Adapter Layer
 *
 * Usage:
 *   import { getPlatformAdapter } from "@/integrations";
 *   const taobao = getPlatformAdapter("taobao");
 *   const order = await taobao.getOrder("TB-xxx");
 *
 * Currently all adapters are Mock (simulated data).
 * To use real APIs: replace Mock adapters with real implementations
 * implementing the same PlatformAdapter interface.
 */

export * from "./core";
export { AdapterFactory, getAdapterFactory, getPlatformAdapter } from "./factory";
export { TaobaoAdapter } from "./taobao";
export { PinduoduoAdapter } from "./pdd";
