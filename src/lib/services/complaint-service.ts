import { prisma, withTenant } from "@/lib/auth/db-client";
import { createEmbedding, searchSimilar, insertVector } from "@/lib/vector-store/milvus-client";
import { config } from "@/lib/utils/config";
import type { TenantContext } from "@/types";

export interface ComplaintRecord {
  id: string;
  title: string;
  description: string;
  category: string | null;
  severity: string;
  resolution: string | null;
  imageUrls: string[];
  createdAt: Date;
}

export class ComplaintService {
  /**
   * Search similar historical complaints.
   * Uses Milvus vector search when available, falls back to PostgreSQL pg_trgm.
   */
  static async searchSimilarCases(
    tenantId: string,
    description: string,
    topK = 5,
  ): Promise<ComplaintRecord[]> {
    // Try Milvus vector search first
    const embedding = await createEmbedding(description);
    const sources = await searchSimilar(
      config.milvus.collections.complaints,
      tenantId,
      embedding,
      topK,
      0.6,
    );

    if (sources.length > 0) {
      const ids = sources.map((s) => s.id);
      return prisma.complaintCase.findMany({
        where: { id: { in: ids }, tenantId },
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          severity: true,
          resolution: true,
          imageUrls: true,
          createdAt: true,
        },
      });
    }

    // Fallback: PostgreSQL pg_trgm similarity search (works for Chinese)
    const fallbackCases = await prisma.$queryRawUnsafe<ComplaintRecord[]>(
      `SELECT id, title, description, category, severity, resolution, "imageUrls", "createdAt"
       FROM "ComplaintCase"
       WHERE "tenantId" = $1::uuid
         AND similarity(title, $2) > 0.15
       ORDER BY similarity(title, $2) DESC
       LIMIT $3`,
      tenantId,
      description,
      topK,
    );

    return fallbackCases;
  }

  /**
   * Create a new complaint case and index it
   */
  static async createCase(
    tenant: TenantContext,
    data: {
      title: string;
      description: string;
      category?: string;
      severity?: string;
      imageUrls?: string[];
      resolution?: string;
    },
  ): Promise<ComplaintRecord> {
    const embedding = await createEmbedding(data.description);

    const record = await withTenant(tenant, (tx) =>
      tx.complaintCase.create({
        data: {
          tenantId: tenant.tenantId,
          title: data.title,
          description: data.description,
          category: data.category ?? "general",
          severity: data.severity ?? "medium",
          imageUrls: data.imageUrls ?? [],
          resolution: data.resolution,
        },
      }),
    );

    await insertVector(config.milvus.collections.complaints, [{
      id: record.id,
      tenantId: tenant.tenantId,
      content: `${data.title}\n${data.description}`,
      embedding,
      metadata: {
        category: data.category,
        severity: data.severity,
      },
    }]);

    return {
      id: record.id,
      title: record.title,
      description: record.description,
      category: record.category,
      severity: record.severity,
      resolution: record.resolution,
      imageUrls: record.imageUrls,
      createdAt: record.createdAt,
    };
  }

  /**
   * Resolve a complaint case
   */
  static async resolveCase(
    tenant: TenantContext,
    caseId: string,
    resolution: string,
  ): Promise<void> {
    await withTenant(tenant, (tx) =>
      tx.complaintCase.update({
        where: { id: caseId },
        data: { resolution, resolvedAt: new Date() },
      }),
    );
  }
}
