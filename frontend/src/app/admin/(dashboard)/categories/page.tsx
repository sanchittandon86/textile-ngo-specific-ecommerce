"use client";

import { useEffect, useState } from "react";
import {
  listAdminCategories,
  createCategory,
  setCategoryActive,
  AdminApiError,
  type AdminCategory,
} from "@/lib/api/admin";

// Mirrors normalizeCategoryValue in product-import.service.js -- a
// client-side preview only, the server is always the source of truth
// for the slug actually stored.
function previewSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function AddCategoryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (category: AdminCategory) => void;
}) {
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
      onClose();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Unable to create this category.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-beige bg-ivory p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl text-ink">Add Category</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          <div>
            <label className="text-xs tracking-wide text-ink-muted uppercase">Name</label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Scarves"
              className="mt-1 w-full border border-beige-dark bg-ivory px-3 py-2 text-sm text-ink focus:border-olive-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs tracking-wide text-ink-muted uppercase">Slug</label>
            <input
              type="text"
              disabled
              value={previewSlug(name)}
              placeholder="auto-generated-from-name"
              className="mt-1 w-full cursor-not-allowed border border-beige-dark bg-beige/40 px-3 py-2 text-sm text-ink-muted"
            />
          </div>

          <div>
            <label className="text-xs tracking-wide text-ink-muted uppercase">Image URL (optional)</label>
            <input
              type="url"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="https://..."
              className="mt-1 w-full border border-beige-dark bg-ivory px-3 py-2 text-sm text-ink focus:border-olive-600 focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-terracotta-600">{error}</p>}

          <div className="mt-2 flex items-center gap-4">
            <button
              type="submit"
              disabled={submitting}
              className="bg-olive-700 px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-ivory uppercase transition-colors hover:bg-olive-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Adding..." : "Add Category"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-xs tracking-wide text-ink-muted uppercase hover:text-olive-700"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<AdminCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

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

  async function handleSetActive(category: AdminCategory, nextActive: boolean) {
    setTogglingId(category.id);

    try {
      const updated = await setCategoryActive(category.id, nextActive);
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
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">Categories</h1>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="bg-olive-700 px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-ivory uppercase transition-colors hover:bg-olive-800"
        >
          Add Category
        </button>
      </div>

      {showAddModal && (
        <AddCategoryModal onClose={() => setShowAddModal(false)} onCreated={handleCreated} />
      )}

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
                      onClick={() => handleSetActive(category, !category.is_active)}
                      disabled={togglingId === category.id}
                      className={`px-3 py-1.5 text-xs font-medium tracking-[0.1em] uppercase text-ivory transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        category.is_active
                          ? "bg-terracotta-600 hover:bg-terracotta-700"
                          : "bg-olive-700 hover:bg-olive-800"
                      }`}
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
