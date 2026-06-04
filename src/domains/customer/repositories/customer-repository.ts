/**
 * Customer Repository — Data access for Customer + UserMemory.
 * Wraps existing Prisma queries; does NOT modify any existing code.
 */

import { prisma, withTenant } from "@/lib/auth/db-client";
import { redis, cacheKey, cacheGet, cacheSet, cacheDel } from "@/lib/utils/redis";
import type {
  CustomerProfile,
  CustomerSearchParams,
  CustomerMemory,
  MemoryEntry,
  MemoryNamespace,
} from "../types";

// ── Customer Profile ─────────────────────────────────────

export const CustomerRepository = {
  async findById(tenantId: string, userId: string): Promise<CustomerProfile | null> {
    return prisma.customerUser.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        tenantId: true,
        externalId: true,
        name: true,
        email: true,
        phone: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    }) as Promise<CustomerProfile | null>;
  },

  async search(params: CustomerSearchParams): Promise<CustomerProfile[]> {
    const where: Record<string, unknown> = { tenantId: params.tenantId };
    if (params.email) where.email = params.email;
    if (params.phone) where.phone = params.phone;
    if (params.externalId) where.externalId = params.externalId;
    if (params.name) where.name = { contains: params.name, mode: "insensitive" };

    return prisma.customerUser.findMany({
      where,
      take: params.limit ?? 20,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        externalId: true,
        name: true,
        email: true,
        phone: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    }) as Promise<CustomerProfile[]>;
  },
};

// ── Customer Memory ──────────────────────────────────────

const DEFAULT_MEMORY_TTL = 7 * 24 * 3600; // 7 days

export const MemoryRepository = {
  async get(
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
    if (record.ttl) await cacheSet(cacheK, record.value, record.ttl);

    return record.value;
  },

  async set(
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
        ttl: entry.ttl ?? DEFAULT_MEMORY_TTL,
      },
      update: {
        value: entry.value as object,
        ttl: entry.ttl ?? DEFAULT_MEMORY_TTL,
      },
    });

    const cacheK = cacheKey(userId, "mem", namespace, entry.key);
    await cacheSet(cacheK, entry.value, entry.ttl ?? DEFAULT_MEMORY_TTL);
  },

  async getAll(
    userId: string,
    namespace: MemoryNamespace,
  ): Promise<Record<string, unknown>> {
    const records = await prisma.userMemory.findMany({
      where: { userId, key: { startsWith: `${namespace}:` } },
    });

    const result: Record<string, unknown> = {};
    for (const r of records) {
      result[r.key.replace(`${namespace}:`, "")] = r.value;
    }
    return result;
  },

  async delete(
    userId: string,
    namespace: MemoryNamespace,
    key: string,
  ): Promise<void> {
    const fullKey = `${namespace}:${key}`;
    await prisma.userMemory.deleteMany({ where: { userId, key: fullKey } });
    await cacheDel(cacheKey(userId, "mem", namespace, key));
  },
};
