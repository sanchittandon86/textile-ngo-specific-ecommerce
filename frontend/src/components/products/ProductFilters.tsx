"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { Category, ProductSortBy, SortOrder } from "@/lib/api/types";

const SORT_OPTIONS: { value: `${ProductSortBy}-${SortOrder}`; label: string }[] = [
  { value: "created_at-desc", label: "Newest" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "name-asc", label: "Name: A to Z" },
];

export function ProductFilters({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");

  const activeCategory = searchParams.get("category") ?? "";
  const activeSort = `${searchParams.get("sortBy") ?? "created_at"}-${
    searchParams.get("order") ?? "desc"
  }`;

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = searchValue.trim();

    // The backend's search endpoint doesn't support combining search with
    // category/sort/pagination -- so searching intentionally clears those.
    if (trimmed) {
      router.push(`/products?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push("/products");
    }
  }

  function handleCategoryChange(slug: string) {
    const params = new URLSearchParams();
    if (slug) params.set("category", slug);
    const sortBy = searchParams.get("sortBy");
    const order = searchParams.get("order");
    if (sortBy) params.set("sortBy", sortBy);
    if (order) params.set("order", order);
    router.push(`/products${params.toString() ? `?${params}` : ""}`);
  }

  function handleSortChange(value: string) {
    const [sortBy, order] = value.split("-");
    const params = new URLSearchParams();
    if (activeCategory) params.set("category", activeCategory);
    params.set("sortBy", sortBy);
    params.set("order", order);
    router.push(`/products?${params}`);
  }

  return (
    <div className="flex flex-col gap-4 border-b border-beige pb-6 sm:flex-row sm:items-center sm:justify-between">
      <form onSubmit={handleSearchSubmit} className="flex w-full max-w-sm gap-2">
        <label htmlFor="product-search" className="sr-only">
          Search products
        </label>
        <input
          id="product-search"
          type="search"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Search products..."
          className="w-full border border-beige-dark bg-ivory px-4 py-2.5 text-sm text-ink placeholder:text-ink-soft focus:border-olive-600 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 border border-olive-700 px-4 py-2.5 text-xs font-medium tracking-wide text-olive-800 uppercase transition-colors hover:bg-olive-700 hover:text-ivory"
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        {categories.length > 0 && (
          <select
            value={activeCategory}
            onChange={(event) => handleCategoryChange(event.target.value)}
            aria-label="Filter by category"
            className="border border-beige-dark bg-ivory px-3 py-2.5 text-sm text-ink focus:border-olive-600 focus:outline-none"
          >
            <option value="">All Categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        )}

        <select
          value={activeSort}
          onChange={(event) => handleSortChange(event.target.value)}
          aria-label="Sort products"
          className="border border-beige-dark bg-ivory px-3 py-2.5 text-sm text-ink focus:border-olive-600 focus:outline-none"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
