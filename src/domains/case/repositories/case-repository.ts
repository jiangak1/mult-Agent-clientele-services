/**
 * Case Repository — Data access for SupportCase.
 * Wraps existing ComplaintCase table access.
 */

import { prisma } from "@/lib/auth/db-client";
import type { SupportCase, CaseStatus, CaseSeverity } from "../types";

function mapCase(row: Record<string, unknown>): SupportCase {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    ticketId: (row.conversationId as string) ?? null,
    title: row.title as string,
    description: row.description as string,
    category: (row.category as string) ?? null,
    subCategory: (row.subCategory as string) ?? null,
    severity: (row.severity as CaseSeverity) ?? "medium",
    status: (row.status as CaseStatus) ?? "open",
    imageUrls: (row.imageUrls as string[]) ?? [],
    assignedTo: (row.assignedTo as string) ?? null,
    duplicateOf: (row.duplicateOf as string) ?? null,
    triagedAt: (row.triagedAt as Date) ?? null,
    resolvedAt: (row.resolvedAt as Date) ?? null,
    verifiedAt: (row.verifiedAt as Date) ?? null,
    archivedAt: (row.archivedAt as Date) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export const CaseRepository = {
  async findById(tenantId: string, caseId: string): Promise<SupportCase | null> {
    const row = await prisma.complaintCase.findFirst({
      where: { id: caseId, tenantId },
    });
    if (!row) return null;
    return mapCase(row as unknown as Record<string, unknown>);
  },

  async findByStatus(
    tenantId: string,
    status: CaseStatus[],
    limit = 20,
  ): Promise<SupportCase[]> {
    const rows = await prisma.complaintCase.findMany({
      where: { tenantId, severity: { in: status } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return (rows as unknown as Record<string, unknown>[]).map(mapCase);
  },

  async findByCategory(
    tenantId: string,
    category: string,
    limit = 20,
  ): Promise<SupportCase[]> {
    const rows = await prisma.complaintCase.findMany({
      where: { tenantId, category },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return (rows as unknown as Record<string, unknown>[]).map(mapCase);
  },

  async resolve(
    tenantId: string,
    caseId: string,
    resolution: string,
  ): Promise<void> {
    await prisma.complaintCase.updateMany({
      where: { id: caseId, tenantId },
      data: { resolution, resolvedAt: new Date() },
    });
  },

  async searchByVector(
    tenantId: string,
    embedding: number[],
    topK = 5,
  ): Promise<Array<{ id: string; score: number }>> {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; score: number }>>(
      `SELECT id, 1 - (embedding <=> $1::vector) AS score
       FROM "ComplaintCase"
       WHERE "tenantId" = $2
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      `[${embedding.join(",")}]`,
      tenantId,
      topK,
    );
    return rows;
  },
};
