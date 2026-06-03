"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";

interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: string;
  stock: number;
  category: string | null;
  imageUrls?: string[];
  attributes?: Record<string, unknown>;
  isActive?: boolean;
  createdAt?: string;
}

interface ProductPanelProps {
  onClose: () => void;
}

const HEADERS = {
  "Content-Type": "application/json",
  "x-tenant-id": "00000000-0000-0000-0000-000000000001",
  "x-user-id": "00000000-0000-0000-0000-000000000101",
};

export function ProductPanel({ onClose }: ProductPanelProps) {
  const { t } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ sku: "", name: "", description: "", price: "", stock: "", category: "", imageUrls: "" });

  const fetchProducts = async () => {
    try {
      const res = await fetch("/api/products", { headers: HEADERS });
      const data = await res.json();
      if (data.success) setProducts(data.data);
    } catch { /* demo mode */ }
  };

  useEffect(() => { fetchProducts(); }, []);

  const resetForm = () => {
    setForm({ sku: "", name: "", description: "", price: "", stock: "", category: "", imageUrls: "" });
    setEditingId(null);
    setAdding(false);
    setError(null);
  };

  const handleAdd = async () => {
    if (!form.sku || !form.name) {
      setError(t("product.errorRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          sku: form.sku,
          name: form.name,
          description: form.description || undefined,
          price: form.price ? Number(form.price) : undefined,
          stock: form.stock ? Number(form.stock) : undefined,
          category: form.category || undefined,
          imageUrls: form.imageUrls ? form.imageUrls.split(",").map((u) => u.trim()).filter(Boolean) : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchProducts();
        resetForm();
      } else {
        setError(data.error ?? t("product.errorSave"));
      }
    } catch {
      setError(t("product.errorNetwork"));
    }
    setLoading(false);
  };

  const handleEdit = async (id: string) => {
    if (!form.name) {
      setError(t("product.errorRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/products", {
        method: "PUT",
        headers: HEADERS,
        body: JSON.stringify({
          id,
          name: form.name,
          description: form.description || undefined,
          price: form.price ? Number(form.price) : undefined,
          stock: form.stock ? Number(form.stock) : undefined,
          category: form.category || undefined,
          imageUrls: form.imageUrls ? form.imageUrls.split(",").map((u) => u.trim()).filter(Boolean) : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchProducts();
        resetForm();
      } else {
        setError(data.error ?? t("product.errorSave"));
      }
    } catch {
      setError(t("product.errorNetwork"));
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/products?id=${id}`, { method: "DELETE", headers: { "x-tenant-id": "00000000-0000-0000-0000-000000000001" } });
      if (res.ok) {
        await fetchProducts();
      }
    } catch { /* demo mode */ }
    setLoading(false);
  };

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setAdding(false);
    setForm({
      sku: p.sku,
      name: p.name,
      description: p.description ?? "",
      price: p.price ?? "",
      stock: String(p.stock ?? 0),
      category: p.category ?? "",
      imageUrls: (p.imageUrls ?? []).join(", "),
    });
  };

  return (
    <aside className="glass-elevated" style={{
      width: 340,
      height: "100%",
      display: "flex",
      flexDirection: "column",
      borderLeft: "1px solid var(--glass-border)",
      borderRadius: 0,
      flexShrink: 0,
    }}>
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--glass-border)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{t("product.title")}</div>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", color: "var(--text-muted)",
            cursor: "pointer", fontSize: 18, padding: "4px 8px",
          }}
        >
          x
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
        {/* Error banner */}
        {error && (
          <div style={{
            padding: "10px 14px",
            marginBottom: 12,
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "var(--accent-error)",
            fontSize: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{
              background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 14, padding: "0 4px",
            }}>x</button>
          </div>
        )}

        {/* Add / Edit form */}
        {(adding || editingId) && (
          <div className="glass" style={{ padding: 14, borderRadius: 12, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
              {editingId ? t("product.editProduct") : t("product.addProduct")}
            </div>

            {!editingId && (
              <Field label={t("product.sku")}>
                <input className="glass-input" style={{ width: "100%", padding: "6px 10px", fontSize: 12 }}
                  value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              </Field>
            )}

            <Field label={t("product.name")}>
              <input className="glass-input" style={{ width: "100%", padding: "6px 10px", fontSize: 12 }}
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>

            <Field label={t("product.description")}>
              <input className="glass-input" style={{ width: "100%", padding: "6px 10px", fontSize: 12 }}
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>

            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Field label={t("product.price")}>
                  <input className="glass-input" type="number" step="0.01" style={{ width: "100%", padding: "6px 10px", fontSize: 12 }}
                    value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label={t("product.stock")}>
                  <input className="glass-input" type="number" style={{ width: "100%", padding: "6px 10px", fontSize: 12 }}
                    value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                </Field>
              </div>
            </div>

            <Field label={t("product.category")}>
              <input className="glass-input" style={{ width: "100%", padding: "6px 10px", fontSize: 12 }}
                value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>

            <Field label={t("product.imageUrls")}>
              <input className="glass-input" style={{ width: "100%", padding: "6px 10px", fontSize: 12 }}
                value={form.imageUrls}
                onChange={(e) => setForm({ ...form, imageUrls: e.target.value })}
                placeholder={t("product.imageUrlsHint") as string} />
            </Field>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="glass-btn glass-btn-primary" style={{ flex: 1, fontSize: 12, justifyContent: "center" }}
                disabled={loading || !form.name}
                onClick={() => editingId ? handleEdit(editingId) : handleAdd()}>
                {editingId ? t("product.save") : t("product.add")}
              </button>
              <button className="glass-btn" style={{ flex: 1, fontSize: 12, justifyContent: "center" }}
                onClick={resetForm}>
                {t("product.cancel")}
              </button>
            </div>
          </div>
        )}

        {!adding && !editingId && (
          <button className="glass-btn glass-btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 16 }}
            onClick={() => setAdding(true)}>
            + {t("product.addProduct")}
          </button>
        )}

        {/* Product list */}
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
          {t("product.count", { count: products.length })}
        </div>

        {products.map((p) => (
          <div key={p.id} className="glass" style={{ padding: "12px 14px", marginBottom: 8, borderRadius: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>SKU: {p.sku}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--accent-primary)" }}>
                  &yen;{p.price}
                </div>
                <div style={{ fontSize: 10, color: p.stock > 0 ? "var(--accent-success)" : "var(--accent-error)" }}>
                  {p.stock > 0 ? `${t("product.inStock")}: ${p.stock}` : t("product.outOfStock")}
                </div>
              </div>
            </div>

            {p.description && (
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6, lineHeight: 1.4 }}>
                {p.description}
              </div>
            )}

            {p.imageUrls && p.imageUrls.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 6, marginBottom: 4, overflowX: "auto" }}>
                {p.imageUrls.slice(0, 3).map((url, i) => (
                  <img key={i} src={url} alt={`${p.name}-${i + 1}`}
                    style={{
                      width: 48, height: 48, borderRadius: 6, objectFit: "cover",
                      border: "1px solid var(--glass-border)",
                    }} />
                ))}
                {p.imageUrls.length > 3 && (
                  <span style={{ fontSize: 10, color: "var(--text-muted)", alignSelf: "center" }}>
                    +{p.imageUrls.length - 3}
                  </span>
                )}
              </div>
            )}

            {p.category && (
              <span className="agent-badge" style={{ fontSize: 10 }}>{p.category}</span>
            )}

            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button className="glass-btn" style={{ flex: 1, fontSize: 11, justifyContent: "center", padding: "4px 0" }}
                onClick={() => startEdit(p)}>
                {t("product.edit")}
              </button>
              <button className="glass-btn" style={{
                flex: 1, fontSize: 11, justifyContent: "center", padding: "4px 0",
                border: "1px solid rgba(239, 68, 68, 0.3)", color: "rgba(239, 68, 68, 0.9)",
              }}
                disabled={loading}
                onClick={() => handleDelete(p.id)}>
                {t("product.delete")}
              </button>
            </div>
          </div>
        ))}

        {products.length === 0 && (
          <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
            {t("product.empty")}
          </div>
        )}
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}
