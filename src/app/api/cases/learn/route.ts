/**
 * Learning Pipeline API
 *
 * POST /api/cases/learn               — Trigger learning pipeline on closed tickets
 * GET  /api/cases/learn?status=...    — Get learning batch status
 */

import { NextRequest, NextResponse } from "next/server";
import { extractTenant } from "@/lib/auth/tenant-middleware";
import { LearningPipeline } from "@/domains/case/services/learning-pipeline";
import type { ApiResponse } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const tenant = extractTenant(req.headers);
    const body = await req.json().catch(() => ({}));

    const batch = await LearningPipeline.run({
      tenantId: tenant.tenantId,
      limit: body.limit ?? 20,
      minConfidence: body.minConfidence ?? 0.85,
      autoCreate: body.autoCreate ?? true,
      since: body.since ? new Date(body.since) : undefined,
    });

    return NextResponse.json({
      success: true,
      data: batch,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Learn error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Learning pipeline failed" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const tenant = extractTenant(req.headers);

  // Return pending reviews (items that need human attention)
  const items = await LearningPipeline.getPendingReviews(tenant.tenantId);

  return NextResponse.json({
    success: true,
    data: items,
    timestamp: new Date().toISOString(),
  } satisfies ApiResponse);
}
