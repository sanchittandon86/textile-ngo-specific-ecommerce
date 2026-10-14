"use client";

import { useEffect, useState } from "react";
import { listAdminCategories, type AdminCategory } from "@/lib/api/admin";

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<AdminCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listAdminCategories()
      .then((result) => {
        if (!cancelled) setCategories(result);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load categories.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink">Categories</h1>

      {error && <p className="mt-4 text-sm text-terracotta-600">{error}</p>}

      {!error && !categories && (
        <div className="mt-6 h-48 animate-pulse border border-beige bg-beige/40" />
      )}

      {!error && categories && categories.length === 0 && (
        <p className="mt-6 text-sm text-ink-muted">No categories found.</p>
      )}

      {!error && categories && categories.length > 0 && (
        <div className="mt-6 overflow-x-auto border border-beige">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-beige bg-cream text-xs tracking-wide text-ink-muted uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="border-b border-beige last:border-0">
                  <td className="px-4 py-3 text-ink">{category.name}</td>
                  <td className="px-4 py-3 text-ink-muted">{category.slug}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 text-xs tracking-wide uppercase ${
                        category.is_active
                          ? "bg-sage-100 text-olive-700"
                          : "bg-beige text-ink-muted"
                      }`}
                    >
                      {category.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
