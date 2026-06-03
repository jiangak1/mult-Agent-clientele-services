import { NextRequest, NextResponse } from "next/server";
import { processMessage, createConversation } from "@/lib/workflows/graph";
import { extractTenant } from "@/lib/auth/tenant-middleware";
import type { ApiResponse } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const tenant = extractTenant(req.headers);
    const body = await req.json();

    const { message, conversationId, imageUrls } = body;

    const hasImages = Array.isArray(imageUrls) && imageUrls.length > 0;
    if ((!message || typeof message !== "string") && !hasImages) {
      return NextResponse.json(
        { success: false, error: "message is required" } satisfies ApiResponse,
        { status: 400 },
      );
    }

    const userMessage = (message && typeof message === "string") ? message : "";

    if (!tenant.userId) {
      return NextResponse.json(
        { success: false, error: "x-user-id header required" } satisfies ApiResponse,
        { status: 401 },
      );
    }

    const convId = conversationId ?? await createConversation(tenant.tenantId, tenant.userId);

    // Generate a title from the first user message for new conversations
    const isNewConversation = !conversationId;
    if (isNewConversation) {
      const title = userMessage ? (userMessage.length > 30 ? userMessage.slice(0, 30) + "..." : userMessage) : "图片咨询";
      const { prisma: prismaClient } = await import("@/lib/auth/db-client");
      await prismaClient.conversation.update({
        where: { id: convId },
        data: { metadata: { title } },
      }).catch(() => {});
    }

    const result = await processMessage(
      { tenantId: tenant.tenantId, userId: tenant.userId, conversationId: convId, metadata: {} },
      userMessage || "用户发送了一张图片",
      imageUrls,
    );

    const finalResult = result.agentResults.get(result.currentAgent);

    return NextResponse.json({
      success: true,
      data: {
        conversationId: convId,
        message: finalResult?.content ?? "",
        agentType: result.currentAgent,
        intent: result.intent,
        metadata: finalResult?.metadata ?? {},
        shouldEscalate: result.shouldEscalate,
      },
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Chat error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal error" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const tenant = extractTenant(req.headers);
  const convId = req.nextUrl.searchParams.get("conversationId");

  if (!convId) {
    return NextResponse.json(
      { success: false, error: "conversationId required" } satisfies ApiResponse,
      { status: 400 },
    );
  }

  const { prisma, withTenant } = await import("@/lib/auth/db-client");

  const messages = await withTenant(tenant, (tx) =>
    tx.message.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
  );

  return NextResponse.json({
    success: true,
    data: messages.map((m) => ({
      id: m.id,
      role: m.role,
      agentType: m.agentType,
      content: m.content,
      metadata: m.metadata,
      createdAt: m.createdAt.toISOString(),
    })),
    timestamp: new Date().toISOString(),
  } satisfies ApiResponse);
}
