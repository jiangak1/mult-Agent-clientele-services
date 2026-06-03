import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/auth/db-client";
import { extractTenant } from "@/lib/auth/tenant-middleware";
import type { ApiResponse } from "@/types";

export async function GET(req: NextRequest) {
  const tenant = extractTenant(req.headers);
  const category = req.nextUrl.searchParams.get("category");

  try {
    const where: Record<string, unknown> = {
      tenantId: tenant.tenantId,
      isActive: true,
    };
    if (category) where.category = category;

    const products = await prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        price: p.price.toString(),
        stock: p.stock,
        category: p.category,
        imageUrls: p.imageUrls,
        attributes: p.attributes,
        isActive: p.isActive,
        createdAt: p.createdAt.toISOString(),
      })),
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Products error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch products" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const tenant = extractTenant(req.headers);

  try {
    const body = await req.json();
    const { sku, name, description, price, stock, category, imageUrls, attributes } = body;

    if (!sku || !name) {
      return NextResponse.json(
        { success: false, error: "sku and name are required" } satisfies ApiResponse,
        { status: 400 },
      );
    }

    const product = await prisma.product.create({
      data: {
        tenantId: tenant.tenantId,
        sku: String(sku),
        name: String(name),
        description: description ? String(description) : null,
        price: price ? Number(price) : 0,
        stock: stock ? Number(stock) : 0,
        category: category ? String(category) : null,
        imageUrls: imageUrls ?? [],
        attributes: attributes ?? {},
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        price: product.price.toString(),
        stock: product.stock,
        category: product.category,
        imageUrls: product.imageUrls,
        createdAt: product.createdAt.toISOString(),
      },
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Create product error:", error);
    const message = error instanceof Error && error.message.includes("Unique constraint")
      ? "SKU already exists"
      : "Failed to create product";
    return NextResponse.json(
      { success: false, error: message } satisfies ApiResponse,
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const tenant = extractTenant(req.headers);

  try {
    const body = await req.json();
    const { id, name, description, price, stock, category, imageUrls, attributes, isActive } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id is required" } satisfies ApiResponse,
        { status: 400 },
      );
    }

    // Verify tenant ownership
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing || existing.tenantId !== tenant.tenantId) {
      return NextResponse.json(
        { success: false, error: "Product not found" } satisfies ApiResponse,
        { status: 404 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = Number(price);
    if (stock !== undefined) updateData.stock = Number(stock);
    if (category !== undefined) updateData.category = category;
    if (imageUrls !== undefined) updateData.imageUrls = imageUrls;
    if (attributes !== undefined) updateData.attributes = attributes;
    if (isActive !== undefined) updateData.isActive = isActive;

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        price: product.price.toString(),
        stock: product.stock,
        category: product.category,
        imageUrls: product.imageUrls,
      },
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Update product error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update product" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const tenant = extractTenant(req.headers);
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { success: false, error: "id required" } satisfies ApiResponse,
      { status: 400 },
    );
  }

  try {
    // Verify tenant ownership before soft delete
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing || existing.tenantId !== tenant.tenantId) {
      return NextResponse.json(
        { success: false, error: "Product not found" } satisfies ApiResponse,
        { status: 404 },
      );
    }

    await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({
      success: true,
      message: "Product deactivated",
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse);
  } catch (error) {
    console.error("[API] Delete product error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete product" } satisfies ApiResponse,
      { status: 500 },
    );
  }
}
