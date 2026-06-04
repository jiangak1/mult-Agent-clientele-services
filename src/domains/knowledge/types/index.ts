/**
 * Knowledge Domain — Types
 *
 * Represents knowledge base entries and vector search infrastructure.
 * Maps to KnowledgeBase in the existing Prisma schema.
 */

// ── Knowledge Entry ──────────────────────────────────────

export type KnowledgeCategory =
  | "faq"
  | "policy"
  | "product_info"
  | "troubleshooting"
  | "presale"
  | "aftersale";

export interface KnowledgeEntry {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  category: KnowledgeCategory | null;
  source: string | null;
  embedding: number[] | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── RAG Context ──────────────────────────────────────────

export interface KnowledgeSource {
  id: string;
  title: string;
  content: string;
  score: number;
  source: string;
}

export interface RAGContext {
  sources: KnowledgeSource[];
  systemPrompt: string;
  userPrompt: string;
}

// ── Vector Store ─────────────────────────────────────────

export interface VectorSearchParams {
  collection: string;
  tenantId: string;
  embedding: number[];
  topK?: number;
  threshold?: number;
}

export interface VectorSearchResult {
  sources: KnowledgeSource[];
}

export interface VectorInsertParams {
  collection: string;
  records: Array<{
    id: string;
    tenantId: string;
    content: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }>;
}

// ── Embedding ────────────────────────────────────────────

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimension: number;
}

// ── Knowledge Search ─────────────────────────────────────

export interface KnowledgeSearchParams {
  tenantId: string;
  query: string;
  type: "presale" | "aftersale";
  topK?: number;
}

export interface KnowledgeSearchResult {
  content: string;
  sources: KnowledgeSource[];
}
