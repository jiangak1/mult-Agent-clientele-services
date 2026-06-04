/**
 * Knowledge Service — RAG context building + vector search.
 * Delegates to existing RAGEngine for backward compat.
 */

import { KnowledgeRepository } from "../repositories/knowledge-repository";
import { RAGEngine } from "@/lib/rag/rag-engine";
import type {
  KnowledgeEntry,
  KnowledgeSource,
  KnowledgeSearchParams,
  KnowledgeSearchResult,
  RAGContext,
} from "../types";

export const KnowledgeService = {
  // ── Entry Management ─────────────────────────────────

  async getEntry(tenantId: string, id: string): Promise<KnowledgeEntry | null> {
    return KnowledgeRepository.findById(tenantId, id);
  },

  async getEntriesByCategory(
    tenantId: string,
    category: string,
    limit?: number,
  ): Promise<KnowledgeEntry[]> {
    return KnowledgeRepository.findByCategory(tenantId, category, limit);
  },

  // ── RAG (delegates to existing RAGEngine) ────────────

  async query(params: KnowledgeSearchParams): Promise<KnowledgeSearchResult> {
    const { tenantId, query, type } = params;
    const { content, sources } = await RAGEngine.query(tenantId, query, type);
    return { content, sources };
  },

  async buildPresaleContext(
    tenantId: string,
    query: string,
    topK?: number,
  ): Promise<RAGContext> {
    return RAGEngine.buildPresaleContext(tenantId, query, topK);
  },

  async buildAftersaleContext(
    tenantId: string,
    query: string,
    topK?: number,
  ): Promise<RAGContext> {
    return RAGEngine.buildAftersaleContext(tenantId, query, topK);
  },

  // ── Direct Vector Search ──────────────────────────────

  async vectorSearch(
    collection: string,
    tenantId: string,
    query: string,
    topK = 5,
    threshold?: number,
  ): Promise<KnowledgeSource[]> {
    const embedding = await KnowledgeRepository.embedText(query);
    return KnowledgeRepository.vectorSearch(collection, tenantId, embedding, topK, threshold);
  },

  async fullTextSearch(
    tenantId: string,
    query: string,
    limit?: number,
  ): Promise<KnowledgeSource[]> {
    return KnowledgeRepository.fullTextSearch(tenantId, query, limit);
  },
};
