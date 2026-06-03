import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/auth/db-client";
import { extractTenant } from "@/lib/auth/tenant-middleware";
import type { ApiResponse } from "@/types";

export async function GET(req: NextRequest) {
  const tenant = extractTenant(req.headers);
  const userId = req.nextUrl.searchParams.get("userId") ?? tenant.userId;

  if (!userId) {
    return NextResponse.json(
      { success: false, error: "userId required" } satisfies ApiResponse,
      { status: 400 },
    );
  }

  try {
    const conversations = await prisma.conversation.findMany({
      where: { tenantId: tenant.tenantId, userId, status: { not: "solution_retained" } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: conversations.map((c) => ({
        id: c.id,
        intent: c.intent,
        title: ((c.metadata as Record<string, unknown>)?.title as string) ?? null,
        status: c.status,
        updatedAt: c.updatedAt.toISOString(),
        lastMessage: c.messages[0]?.content?.slice(0, 80) ?? "",
      })),
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Conversations error:", error);
    return NextResponse.json({
      success: true,
      data: [],
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  }
}

export async function DELETE(req: NextRequest) {
  const tenant = extractTenant(req.headers);
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  if (!conversationId) {
    return NextResponse.json(
      { success: false, error: "conversationId required" } satisfies ApiResponse,
      { status: 400 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const keepSolution = body.keepSolution === true;

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId: tenant.tenantId },
    });

    if (!conv) {
      return NextResponse.json(
        { success: false, error: "Conversation not found" } satisfies ApiResponse,
        { status: 404 },
      );
    }

    if (keepSolution) {
      // Extract aftersale resolution and save to ComplaintCase for future retrieval
      const messages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        select: { role: true, agentType: true, content: true, metadata: true },
      });

      const aftersaleMessages = messages.filter(
        (m) => m.agentType === "aftersale" && m.role === "assistant",
      );
      const userQuestion = messages.find(
        (m) => m.role === "user",
      );

      if (aftersaleMessages.length > 0 && userQuestion) {
        const reply = aftersaleMessages[aftersaleMessages.length - 1];
        const imageUrls = (userQuestion.metadata as Record<string, unknown>)?.imageUrls as string[] | undefined;

        import("@/lib/services/complaint-service").then(({ ComplaintService }) => {
          ComplaintService.createCase(
            { tenantId: tenant.tenantId, userId: conv.userId },
            {
              title: userQuestion.content.slice(0, 100),
              description: userQuestion.content,
              category: conv.subIntent ?? "general",
              severity: "medium",
              imageUrls: imageUrls ?? [],
              resolution: reply.content,
            },
          ).catch((err) => {
            console.warn("[API] Failed to save complaint case:", err);
          });
        });
      }

      // Keep solution: mark conversation as "solution_retained" and clear messages only
      await prisma.message.deleteMany({ where: { conversationId } });
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "solution_retained", metadata: { ...((conv.metadata as Record<string, unknown>) ?? {}), solutionRetainedAt: new Date().toISOString() } },
      });
    } else {
      // Full delete: remove messages then conversation
      await prisma.message.deleteMany({ where: { conversationId } });
      await prisma.conversation.delete({ where: { id: conversationId } });
    }

    return NextResponse.json({
      success: true,
      data: { conversationId, solutionRetained: keepSolution },
      message: keepSolution ? "Conversation deleted, solution retained" : "Conversation fully deleted",
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Delete conversation error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Delete failed" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}
