"use client";

import { useEffect, useState } from "react";
import {
  listAdminCategories,
  createCategory,
  setCategoryActive,
  AdminApiError,
  type AdminCategory,
} from "@/lib/api/admin";

function AddCategoryForm({ onCreated }: { onCreated: (category: AdminCategory) => void }) {
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const created = await createCategory(name.trim(), imageUrl.trim());
      onCreated(created);
      setName("");
      setImageUrl("");
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Unable to create this category.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-wrap items-end gap-4 border border-beige p-5">
      <div>
        <label className="text-xs tracking-wide text-ink-muted uppercase">Name</label>
        <input
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Scarves"
          className="mt-1 w-56 border border-beige-dark bg-ivory px-3 py-2 text-sm text-ink focus:border-olive-600 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-xs tracking-wide text-ink-muted uppercase">Image URL (optional)</label>
        <input
          type="url"
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
          placeholder="https://..."
          className="mt-1 w-72 border border-beige-dark bg-ivory px-3 py-2 text-sm text-ink focus:border-olive-600 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="bg-olive-700 px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-ivory uppercase transition-colors hover:bg-olive-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Adding..." : "Add Category"}
      </button>
      {error && <p className="w-full text-sm text-terracotta-600">{error}</p>}
    </form>
  );
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<AdminCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

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

  function handleCreated(category: AdminCategory) {
    setCategories((current) =>
      [...(current ?? []), category].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  async function handleToggle(category: AdminCategory) {
    setTogglingId(category.id);

    try {
      const updated = await setCategoryActive(category.id, !category.is_active);
      setCategories((current) =>
        (current ?? []).map((c) => (c.id === updated.id ? updated : c))
      );
    } catch {
      setError("Unable to update that category's status.");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink">Categories</h1>

      <AddCategoryForm onCreated={handleCreated} />

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
                <th className="px-4 py-3 font-medium"></th>
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
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleToggle(category)}
                      disabled={togglingId === category.id}
                      className="text-xs tracking-wide text-ink-muted uppercase hover:text-olive-700 disabled:opacity-40"
                    >
                      {togglingId === category.id
                        ? "Saving..."
                        : category.is_active
                          ? "Deactivate"
                          : "Activate"}
                    </button>
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
