import { NextRequest, NextResponse } from "next/server";
import { CaseService } from "@/domains/case";
import { extractTenant } from "@/lib/auth/tenant-middleware";
import type { ApiResponse } from "@/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenant = extractTenant(req.headers);
    const { id } = await params;
    const body = await req.json();

    const { rating, isResolved, comment } = body;
    if (typeof rating !== "number" || rating < 1 || rating > 5) {
      return NextResponse.json(
        { success: false, error: "rating must be a number 1-5" } satisfies ApiResponse,
        { status: 400 },
      );
    }

    await CaseService.recordFeedback(tenant.tenantId, id, {
      rating,
      isResolved: !!isResolved,
      comment,
    });

    return NextResponse.json({
      success: true,
      data: { caseId: id, rating, isResolved },
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Case feedback error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Feedback failed" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}
