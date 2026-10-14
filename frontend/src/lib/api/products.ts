import { apiFetch, apiFetchEnvelope } from "./client";
import type { Product, ProductListParams, ProductListPagination } from "./types";

export interface ProductListResult {
  products: Product[];
  pagination: ProductListPagination;
}

export async function getProducts(
  params: ProductListParams = {}
): Promise<ProductListResult> {
  const query = new URLSearchParams();

  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  if (params.category) query.set("category", params.category);
  if (params.sortBy) query.set("sortBy", params.sortBy);
  if (params.order) query.set("order", params.order);

  const qs = query.toString();

  const envelope = await apiFetchEnvelope<
    Product[],
    { pagination: ProductListPagination }
  >(`/api/products${qs ? `?${qs}` : ""}`);

  return { products: envelope.data, pagination: envelope.pagination };
}

export interface ProductSearchResult {
  products: Product[];
  count: number;
}

export async function searchProducts(
  query: string
): Promise<ProductSearchResult> {
  const qs = new URLSearchParams({ q: query }).toString();

  const envelope = await apiFetchEnvelope<Product[], { count: number }>(
    `/api/products/search?${qs}`
  );

  return { products: envelope.data, count: envelope.count };
}

export function getProductBySlug(slug: string): Promise<Product> {
  return apiFetch<Product>(`/api/products/${encodeURIComponent(slug)}`);
}
