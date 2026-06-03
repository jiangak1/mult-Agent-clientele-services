import { prisma } from "@/lib/auth/db-client";
import { redis, cacheKey, cacheGet, cacheSet, cacheDel } from "@/lib/utils/redis";
import type { MemoryEntry, MemoryNamespace } from "@/types";

// ============================================
// Long-Term Memory Manager
// ============================================

const DEFAULT_TTL = 7 * 24 * 3600; // 7 days

export class LongTermMemory {
  /**
   * Retrieve a memory entry for a user
   */
  static async get(
    userId: string,
    namespace: MemoryNamespace,
    key: string,
  ): Promise<unknown | null> {
    const cacheK = cacheKey(userId, "mem", namespace, key);

    const cached = await cacheGet(cacheK);
    if (cached !== null) return cached;

    const record = await prisma.userMemory.findUnique({
      where: { userId_key: { userId, key: `${namespace}:${key}` } },
    });

    if (!record) return null;

    const value = record.value;
    if (record.ttl) {
      await cacheSet(cacheK, value, record.ttl);
    }

    return value;
  }

  /**
   * Store a memory entry
   */
  static async set(
    userId: string,
    namespace: MemoryNamespace,
    entry: MemoryEntry,
  ): Promise<void> {
    const fullKey = `${namespace}:${entry.key}`;

    await prisma.userMemory.upsert({
      where: { userId_key: { userId, key: fullKey } },
      create: {
        userId,
        key: fullKey,
        value: entry.value as object,
        ttl: entry.ttl ?? DEFAULT_TTL,
      },
      update: {
        value: entry.value as object,
        ttl: entry.ttl ?? DEFAULT_TTL,
      },
    });

    const cacheK = cacheKey(userId, "mem", namespace, entry.key);
    await cacheSet(cacheK, entry.value, entry.ttl ?? DEFAULT_TTL);
  }

  /**
   * Get all memories in a namespace
   */
  static async getAll(
    userId: string,
    namespace: MemoryNamespace,
  ): Promise<Record<string, unknown>> {
    const records = await prisma.userMemory.findMany({
      where: {
        userId,
        key: { startsWith: `${namespace}:` },
      },
    });

    const result: Record<string, unknown> = {};
    for (const record of records) {
      const shortKey = record.key.replace(`${namespace}:`, "");
      result[shortKey] = record.value;
    }
    return result;
  }

  /**
   * Delete a memory entry
   */
  static async delete(
    userId: string,
    namespace: MemoryNamespace,
    key: string,
  ): Promise<void> {
    const fullKey = `${namespace}:${key}`;
    await prisma.userMemory.deleteMany({
      where: { userId, key: fullKey },
    });
    await cacheDel(cacheKey(userId, "mem", namespace, key));
  }

  /**
   * Summarize and store conversation context
   */
  static async storeConversationContext(
    userId: string,
    conversationId: string,
    summary: string,
    entities: Record<string, string>,
  ): Promise<void> {
    await LongTermMemory.set(userId, "conversation_history", {
      key: conversationId,
      value: { summary, entities, updatedAt: new Date().toISOString() },
    });
  }

  /**
   * Store product interest signal
   */
  static async storeProductInterest(
    userId: string,
    productIds: string[],
    categories: string[],
  ): Promise<void> {
    await LongTermMemory.set(userId, "product_interest", {
      key: "preferences",
      value: {
        productIds,
        categories,
        lastUpdated: new Date().toISOString(),
      },
    });
  }

  /**
   * Store complaint context for future reference
   */
  static async storeComplaintContext(
    userId: string,
    complaintId: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    await LongTermMemory.set(userId, "complaint_context", {
      key: complaintId,
      value: { ...context, recordedAt: new Date().toISOString() },
    });
  }
}
