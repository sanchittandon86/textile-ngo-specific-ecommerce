"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listAdminProducts, type AdminProduct, type Pagination } from "@/lib/api/admin";
import { formatMoney } from "@/lib/format";

export default function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listAdminProducts(page, 20)
      .then((result) => {
        if (cancelled) return;
        setProducts(result.products);
        setPagination(result.pagination);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load products.");
      });

    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">Products</h1>
        <Link
          href="/admin/products/import"
          className="border border-olive-700 px-4 py-2 text-xs font-medium tracking-[0.12em] text-olive-800 uppercase transition-colors hover:bg-olive-700 hover:text-ivory"
        >
          Bulk Import
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Products are managed only through Excel bulk import -- there is no individual
        product form.
      </p>

      {error && <p className="mt-4 text-sm text-terracotta-600">{error}</p>}

      {!error && !products && (
        <div className="mt-6 h-64 animate-pulse border border-beige bg-beige/40" />
      )}

      {!error && products && products.length === 0 && (
        <p className="mt-6 text-sm text-ink-muted">No products found.</p>
      )}

      {!error && products && products.length > 0 && (
        <div className="mt-6 overflow-x-auto border border-beige">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-beige bg-cream text-xs tracking-wide text-ink-muted uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-beige last:border-0">
                  <td className="px-4 py-3 text-ink">{product.name}</td>
                  <td className="px-4 py-3 text-ink-muted">{product.category_name ?? "--"}</td>
                  <td className="px-4 py-3 text-ink-muted">{formatMoney(product.price)}</td>
                  <td className="px-4 py-3 text-ink-muted">{product.stock_quantity}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 text-xs tracking-wide uppercase ${
                        product.is_published
                          ? "bg-sage-100 text-olive-700"
                          : "bg-beige text-ink-muted"
                      }`}
                    >
                      {product.is_published ? "Published" : "Draft"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-xs text-ink-muted">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-2 py-1 uppercase tracking-wide disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page >= pagination.totalPages}
            className="px-2 py-1 uppercase tracking-wide disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
