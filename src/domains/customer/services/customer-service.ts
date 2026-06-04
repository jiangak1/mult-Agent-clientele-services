/**
 * Customer Service — Customer profile + memory management.
 * Delegates to existing LongTermMemory + Prisma for backward compat.
 */

import { CustomerRepository, MemoryRepository } from "../repositories/customer-repository";
import { LongTermMemory } from "@/lib/memory/long-term-memory";
import type {
  CustomerProfile,
  CustomerSearchParams,
  CustomerSummary,
  MemoryEntry,
  MemoryNamespace,
  ProductInterest,
  ComplaintContext,
} from "../types";

export const CustomerService = {
  // ── Profile ──────────────────────────────────────────

  async getProfile(tenantId: string, userId: string): Promise<CustomerProfile | null> {
    return CustomerRepository.findById(tenantId, userId);
  },

  async searchProfiles(params: CustomerSearchParams): Promise<CustomerProfile[]> {
    return CustomerRepository.search(params);
  },

  // ── Memory (delegates to existing LongTermMemory) ────

  async getMemory(
    userId: string,
    namespace: MemoryNamespace,
    key: string,
  ): Promise<unknown | null> {
    return LongTermMemory.get(userId, namespace as Parameters<typeof LongTermMemory.get>[1], key);
  },

  async setMemory(
    userId: string,
    namespace: MemoryNamespace,
    entry: MemoryEntry,
  ): Promise<void> {
    await LongTermMemory.set(
      userId,
      namespace as Parameters<typeof LongTermMemory.set>[1],
      entry as Parameters<typeof LongTermMemory.set>[2],
    );
  },

  async getAllMemory(
    userId: string,
    namespace: MemoryNamespace,
  ): Promise<Record<string, unknown>> {
    return LongTermMemory.getAll(
      userId,
      namespace as Parameters<typeof LongTermMemory.getAll>[1],
    );
  },

  async deleteMemory(
    userId: string,
    namespace: MemoryNamespace,
    key: string,
  ): Promise<void> {
    await LongTermMemory.delete(
      userId,
      namespace as Parameters<typeof LongTermMemory.delete>[1],
      key,
    );
  },

  // ── Domain-specific convenience ──────────────────────

  async storeProductInterest(
    userId: string,
    productIds: string[],
    categories: string[],
  ): Promise<void> {
    await LongTermMemory.storeProductInterest(userId, productIds, categories);
  },

  async storeComplaintContext(
    userId: string,
    complaintId: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    await LongTermMemory.storeComplaintContext(userId, complaintId, context);
  },

  // ── Summary (for Agent context) ──────────────────────

  async getSummary(tenantId: string, userId: string): Promise<CustomerSummary | null> {
    const profile = await CustomerRepository.findById(tenantId, userId);
    if (!profile) return null;

    const preferences = await LongTermMemory.get(userId, "product_interest", "preferences")
      .catch(() => null) as ProductInterest | null;

    return {
      id: profile.id,
      name: profile.name,
      hasOrders: false, // future: check OrderCache
      recentProductInterest: preferences?.categories ?? [],
      activeComplaints: 0, // future: count from SupportCase
      totalConversations: 0, // future: count from Conversation
      lastActiveAt: profile.updatedAt,
    };
  },
};
