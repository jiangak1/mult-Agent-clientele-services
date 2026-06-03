import { MilvusClient } from "@zilliz/milvus2-sdk-node";
import { config } from "@/lib/utils/config";
import type { Source } from "@/types";

let _milvusClient: MilvusClient | null = null;

function getMilvusClient(): MilvusClient {
  if (!_milvusClient) {
    _milvusClient = new MilvusClient({
      address: config.milvus.address,
      username: "",
      password: "",
      database: config.milvus.dbName,
    });
  }
  return _milvusClient;
}

// ============================================
// Collection Management
// ============================================

let milvusAvailable = true;

async function ensureCollection(name: string, dim = 1024): Promise<void> {
  if (!milvusAvailable) return;
  try {
    const client = getMilvusClient();
    const hasCollection = await client.hasCollection({ collection_name: name });
    if (!hasCollection.value) {
      await client.createCollection({
        collection_name: name,
        fields: [
          { name: "id", data_type: "VarChar", max_length: 64, is_primary_key: true },
          { name: "tenant_id", data_type: "VarChar", max_length: 64 },
          { name: "content", data_type: "VarChar", max_length: 65535 },
          { name: "embedding", data_type: "FloatVector", dim },
          { name: "metadata", data_type: "JSON" },
        ],
      });
      await client.createIndex({
        collection_name: name,
        field_name: "embedding",
        index_type: "IVF_FLAT",
        metric_type: "COSINE",
        params: { nlist: 128 },
      });
    }
    await client.loadCollection({ collection_name: name });
  } catch (err) {
    console.warn(`[Milvus] ensureCollection failed (${err instanceof Error ? err.message : 'unknown'}), Milvus disabled`);
    milvusAvailable = false;
  }
}

// ============================================
// Vector Operations
// ============================================

export async function insertVector(
  collection: string,
  records: {
    id: string;
    tenantId: string;
    content: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }[],
): Promise<void> {
  if (!milvusAvailable) return;
  try {
    await ensureCollection(collection);
    const client = getMilvusClient();
    await client.insert({
      collection_name: collection,
      data: records.map((r) => ({
        id: r.id,
        tenant_id: r.tenantId,
        content: r.content,
        embedding: r.embedding,
        metadata: JSON.stringify(r.metadata ?? {}),
      })),
    });
    await client.flush({ collection_names: [collection] });
  } catch (err) {
    console.warn(`[Milvus] insertVector failed, Milvus disabled`);
    milvusAvailable = false;
  }
}

export async function searchSimilar(
  collection: string,
  tenantId: string,
  embedding: number[],
  topK = 5,
  threshold = 0.7,
): Promise<Source[]> {
  if (!milvusAvailable || embedding.length === 0) return [];
  try {
    await ensureCollection(collection);

    const client = getMilvusClient();
    const results = await client.search({
      collection_name: collection,
      vectors: [embedding],
      topk: topK,
      metric_type: "COSINE",
      filter: `tenant_id == "${tenantId}"`,
      output_fields: ["id", "content", "metadata"],
    });

    return (results.results ?? []).flatMap((r) =>
      r.filter((item: { score: number }) => item.score >= threshold).map((item) => ({
        id: String(item.id ?? ""),
        title: "",
        content: String(item.content ?? ""),
        score: item.score ?? 0,
        source: collection,
      })),
    );
  } catch (err) {
    console.warn(`[Milvus] searchSimilar failed, Milvus disabled`);
    milvusAvailable = false;
    return [];
  }
}

export async function deleteVectors(
  collection: string,
  ids: string[],
): Promise<void> {
  if (!milvusAvailable) return;
  try {
    const client = getMilvusClient();
    await client.deleteEntities({
      collection_name: collection,
      filter: `id in [${ids.map((id) => `"${id}"`).join(",")}]`,
    });
  } catch (err) {
    console.warn(`[Milvus] deleteVectors failed, Milvus disabled`);
    milvusAvailable = false;
  }
}

function embeddingUrl(): string {
  return config.llm.embeddingBaseUrl
    ? `${config.llm.embeddingBaseUrl}/embeddings`
    : `${config.llm.baseUrl}/embeddings`;
}

function embeddingApiKey(): string {
  return config.llm.embeddingApiKey || config.llm.apiKey;
}

export async function createEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(embeddingUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${embeddingApiKey()}`,
      },
      body: JSON.stringify({
        model: config.llm.embeddingModel,
        input: text,
      }),
    });

    if (!response.ok) {
      console.warn(`[Embedding] API returned ${response.status}, falling back to empty vector`);
      return [];
    }

    const data = await response.json();
    return data.data?.[0]?.embedding ?? [];
  } catch (err) {
    console.warn(`[Embedding] Service unavailable (${err instanceof Error ? err.message : 'unknown'}), falling back to empty vector`);
    return [];
  }
}

export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    const response = await fetch(embeddingUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${embeddingApiKey()}`,
      },
      body: JSON.stringify({
        model: config.llm.embeddingModel,
        input: texts,
      }),
    });

    if (!response.ok) {
      console.warn(`[Embedding] API returned ${response.status}, falling back to empty vectors`);
      return texts.map(() => []);
    }

    const data = await response.json();
    return (data.data ?? []).map((d: { embedding: number[] }) => d.embedding);
  } catch (err) {
    console.warn(`[Embedding] Service unavailable (${err instanceof Error ? err.message : 'unknown'}), falling back to empty vectors`);
    return texts.map(() => []);
  }
}
