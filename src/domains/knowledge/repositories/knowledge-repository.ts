/**
 * Knowledge Repository — Data access for KnowledgeBase + Vector operations.
 * Wraps Prisma + existing Milvus client.
 */

import { prisma } from "@/lib/auth/db-client";
import { searchSimilar, createEmbedding } from "@/lib/vector-store/milvus-client";
import type { KnowledgeEntry, KnowledgeSource } from "../types";

export const KnowledgeRepository = {
  async findById(tenantId: string, id: string): Promise<KnowledgeEntry | null> {
    const row = await prisma.knowledgeBase.findFirst({
      where: { id, tenantId },
    });
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      title: row.title,
      content: row.content,
      category: row.category as KnowledgeEntry["category"],
      source: row.source,
      embedding: null,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },

  async findByCategory(
    tenantId: string,
    category: string,
    limit = 20,
  ): Promise<KnowledgeEntry[]> {
    const rows = await prisma.knowledgeBase.findMany({
      where: { tenantId, category, isActive: true },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      title: r.title,
      content: r.content,
      category: r.category as KnowledgeEntry["category"],
      source: r.source,
      embedding: null,
      isActive: r.isActive,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },

  // ── Vector Search ───────────────────────────────────────

  async vectorSearch(
    collection: string,
    tenantId: string,
    queryEmbedding: number[],
    topK = 5,
    threshold = 0.7,
  ): Promise<KnowledgeSource[]> {
    return searchSimilar(collection, tenantId, queryEmbedding, topK, threshold);
  },

  async embedText(text: string): Promise<number[]> {
    return createEmbedding(text);
  },

  async embedTexts(texts: string[]): Promise<number[][]> {
    const { createEmbeddings } = await import("@/lib/vector-store/milvus-client");
    return createEmbeddings(texts);
  },

  // ── Full-text search (pgvector fallback) ────────────────

  async fullTextSearch(
    tenantId: string,
    query: string,
    limit = 5,
  ): Promise<KnowledgeSource[]> {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; title: string; content: string; score: number }>>(
      `SELECT id, title, content,
              similarity(title, $2) AS score
       FROM "KnowledgeBase"
       WHERE "tenantId" = $1
         AND "isActive" = true
         AND similarity(title, $2) > 0.15
       ORDER BY score DESC
       LIMIT $3`,
      tenantId,
      query,
      limit,
    );
    return (rows ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      score: r.score,
      source: "pgvector",
    }));
  },
};
