/**
 * Case Repository — PostgreSQL + pgvector data access.
 *
 * Does NOT use Milvus. All vector operations go through pgvector.
 * The `Case` table has an `embedding vector(1024)` column.
 */

import { prisma } from "@/lib/auth/db-client";
import type { CaseRecord, CaseStatus, CaseSeverity, CreateCaseInput, UpdateCaseInput } from "../types";

// ── Row Mapper ───────────────────────────────────────────

function mapRow(r: Record<string, unknown>): CaseRecord {
  return {
    id: r.id as string,
    tenantId: r.tenantId as string,
    productId: (r.productId as string) ?? null,
    issue: r.issue as string,
    solution: r.solution as string,
    category: (r.category as string) ?? null,
    severity: (r.severity as CaseSeverity) ?? "medium",
    status: (r.status as CaseStatus) ?? "resolved",
    successRate: (r.successRate as number) ?? 0,
    satisfactionScore: (r.satisfactionScore as number) ?? 0,
    resolutionCount: (r.resolutionCount as number) ?? 0,
    feedbackCount: (r.feedbackCount as number) ?? 0,
    embedding: null, // Don't send large vectors by default
    ticketId: (r.ticketId as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdAt: r.createdAt as Date,
    updatedAt: r.updatedAt as Date,
  };
}

const CASE_SELECT = {
  id: true, tenantId: true, productId: true, issue: true, solution: true,
  category: true, severity: true, status: true,
  successRate: true, satisfactionScore: true,
  resolutionCount: true, feedbackCount: true,
  ticketId: true, tags: true, metadata: true,
  createdAt: true, updatedAt: true,
} as const;

// ── Repository ───────────────────────────────────────────

export const CaseRepository = {
  // ── CRUD ──────────────────────────────────────────────

  async findById(tenantId: string, caseId: string): Promise<CaseRecord | null> {
    const row = await prisma.case.findFirst({
      where: { id: caseId, tenantId },
      select: CASE_SELECT,
    });
    if (!row) return null;
    return mapRow(row as unknown as Record<string, unknown>);
  },

  async create(input: CreateCaseInput, embedding: number[]): Promise<CaseRecord> {
    const row = await prisma.$executeRawUnsafe(
      `INSERT INTO "Case" ("id", "tenantId", "productId", "issue", "solution",
         "category", "severity", "status", "successRate", "satisfactionScore",
         "resolutionCount", "feedbackCount", "embedding", "ticketId", "tags", "metadata",
         "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'resolved', 0, 0, 0, 0,
               $7::vector, $8, $9::text[], $10::jsonb, now(), now())
       RETURNING id`,
      input.tenantId,
      input.productId ?? null,
      input.issue,
      input.solution,
      input.category ?? null,
      input.severity ?? "medium",
      `[${embedding.join(",")}]`,
      input.ticketId ?? null,
      input.tags ?? [],
      JSON.stringify(input.metadata ?? {}),
    );

    // Fetch back the created row
    const recs = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "Case" WHERE "tenantId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      input.tenantId,
    );
    return mapRow(recs[0]);
  },

  async update(
    tenantId: string,
    caseId: string,
    input: UpdateCaseInput,
    embedding?: number[],
  ): Promise<boolean> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (input.solution !== undefined) { sets.push(`"solution" = $${idx++}`); vals.push(input.solution); }
    if (input.category !== undefined) { sets.push(`"category" = $${idx++}`); vals.push(input.category); }
    if (input.severity !== undefined) { sets.push(`"severity" = $${idx++}`); vals.push(input.severity); }
    if (input.status !== undefined) { sets.push(`"status" = $${idx++}`); vals.push(input.status); }
    if (input.successRate !== undefined) { sets.push(`"successRate" = $${idx++}`); vals.push(input.successRate); }
    if (input.satisfactionScore !== undefined) { sets.push(`"satisfactionScore" = $${idx++}`); vals.push(input.satisfactionScore); }
    if (input.tags !== undefined) { sets.push(`"tags" = $${idx++}::text[]`); vals.push(input.tags); }
    if (input.metadata !== undefined) { sets.push(`"metadata" = $${idx++}::jsonb`); vals.push(JSON.stringify(input.metadata)); }
    if (embedding) { sets.push(`"embedding" = $${idx++}::vector`); vals.push(`[${embedding.join(",")}]`); }

    if (sets.length === 0) return false;

    sets.push(`"updatedAt" = now()`);
    vals.push(tenantId, caseId);

    await prisma.$executeRawUnsafe(
      `UPDATE "Case" SET ${sets.join(", ")} WHERE "tenantId" = $${idx} AND "id" = $${idx + 1}`,
      ...vals,
    );
    return true;
  },

  // ── Vector Search (pgvector) ──────────────────────────

  async searchByVector(
    tenantId: string,
    embedding: number[],
    topK = 10,
    minScore = 0.6,
    filters?: { category?: string; productId?: string },
  ): Promise<Array<CaseRecord & { vectorScore: number }>> {
    const conditions: string[] = [`"tenantId" = $1`, `"embedding" IS NOT NULL`, `1 - (embedding <=> $2::vector) >= $3`];
    const vals: unknown[] = [tenantId, `[${embedding.join(",")}]`, minScore];
    let idx = 4;

    if (filters?.category) { conditions.push(`"category" = $${idx++}`); vals.push(filters.category); }
    if (filters?.productId) { conditions.push(`"productId" = $${idx++}`); vals.push(filters.productId); }

    const where = conditions.join(" AND ");

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *, 1 - (embedding <=> $2::vector) AS "vectorScore"
       FROM "Case"
       WHERE ${where}
       ORDER BY embedding <=> $2::vector
       LIMIT $${idx}`,
      ...vals,
      topK,
    );

    return (rows ?? []).map((r) => ({
      ...mapRow(r),
      vectorScore: r.vectorScore as number,
    }));
  },

  // ── Keyword Search (pg_trgm) ──────────────────────────

  async searchByKeyword(
    tenantId: string,
    query: string,
    limit = 20,
  ): Promise<Array<CaseRecord & { keywordScore: number }>> {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *,
              GREATEST(
                similarity("issue", $2),
                similarity("solution", $2)
              ) AS "keywordScore"
       FROM "Case"
       WHERE "tenantId" = $1
         AND (similarity("issue", $2) > 0.1 OR similarity("solution", $2) > 0.1)
       ORDER BY "keywordScore" DESC
       LIMIT $3`,
      tenantId,
      query,
      limit,
    );
    return (rows ?? []).map((r) => ({
      ...mapRow(r),
      keywordScore: r.keywordScore as number,
    }));
  },

  // ── List / Browse ─────────────────────────────────────

  async list(
    tenantId: string,
    options?: { category?: string; status?: CaseStatus; productId?: string; page?: number; pageSize?: number },
  ): Promise<{ rows: CaseRecord[]; total: number }> {
    const where: Record<string, unknown> = { tenantId };
    if (options?.category) where.category = options.category;
    if (options?.status) where.status = options.status;
    if (options?.productId) where.productId = options.productId;

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;

    const [rows, total] = await Promise.all([
      prisma.case.findMany({
        where,
        select: CASE_SELECT,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.case.count({ where }),
    ]);

    return {
      rows: (rows as unknown as Record<string, unknown>[]).map(mapRow),
      total,
    };
  },

  // ── Record Feedback ───────────────────────────────────

  async recordFeedback(
    tenantId: string,
    caseId: string,
    rating: number,
    isResolved: boolean,
  ): Promise<boolean> {
    // Update successRate + satisfactionScore using Welford-like incremental avg
    await prisma.$executeRawUnsafe(
      `UPDATE "Case"
       SET "feedbackCount" = "feedbackCount" + 1,
           "resolutionCount" = "resolutionCount" + CASE WHEN $3 THEN 1 ELSE 0 END,
           "satisfactionScore" = ROUND(
             (("satisfactionScore" * "feedbackCount") + $4) / ("feedbackCount" + 1), 2),
           "successRate" = ROUND(
             (("resolutionCount"::float + CASE WHEN $3 THEN 1 ELSE 0 END)
              / ("feedbackCount"::float + 1))::numeric, 2),
           "updatedAt" = now()
       WHERE "tenantId" = $1 AND "id" = $2`,
      tenantId,
      caseId,
      isResolved,
      rating,
    );
    return true;
  },

  // ── Fetch embedding for an existing case ──────────────

  async getEmbedding(caseId: string): Promise<number[] | null> {
    const rows = await prisma.$queryRawUnsafe<Array<{ embedding: string }>>(
      `SELECT embedding::text FROM "Case" WHERE "id" = $1 AND "embedding" IS NOT NULL`,
      caseId,
    );
    if (!rows?.length) return null;
    return rows[0].embedding
      .replace(/[\[\]]/g, "")
      .split(",")
      .map(Number);
  },

  // ── Batch embedding update ────────────────────────────

  async updateEmbedding(caseId: string, embedding: number[]): Promise<void> {
    await prisma.$executeRawUnsafe(
      `UPDATE "Case" SET "embedding" = $1::vector, "updatedAt" = now() WHERE "id" = $2`,
      `[${embedding.join(",")}]`,
      caseId,
    );
  },
};
