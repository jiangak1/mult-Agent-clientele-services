/**
 * Human Review API — approve/reject extracted cases
 *
 * POST /api/cases/review
 *   { ticketId, extraction, action: "approve"|"reject", modifications?, reviewerId }
 */

import { NextRequest, NextResponse } from "next/server";
import { extractTenant } from "@/lib/auth/tenant-middleware";
import { LearningPipeline } from "@/domains/case/services/learning-pipeline";
import type { ExtractionResult } from "@/domains/case/services/extraction-evaluator";
import type { ApiResponse } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const tenant = extractTenant(req.headers);
    const body = await req.json();

    const { ticketId, extraction, action, modifications, reviewerId } = body;

    if (!ticketId || !extraction || !action) {
      return NextResponse.json(
        { success: false, error: "ticketId, extraction, and action required" } satisfies ApiResponse,
        { status: 400 },
      );
    }

    if (action === "reject") {
      return NextResponse.json({
        success: true,
        data: { ticketId, action: "rejected", reviewedBy: reviewerId },
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse);
    }

    if (action === "approve") {
      const caseId = await LearningPipeline.approveReview(
        tenant.tenantId,
        ticketId,
        extraction as ExtractionResult,
        reviewerId ?? "human",
        modifications,
      );

      return NextResponse.json({
        success: true,
        data: { ticketId, action: "approved", caseId, reviewedBy: reviewerId },
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse);
    }

    return NextResponse.json(
      { success: false, error: "action must be 'approve' or 'reject'" } satisfies ApiResponse,
      { status: 400 },
    );
  } catch (error) {
    console.error("[API] Review error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Review failed" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}
