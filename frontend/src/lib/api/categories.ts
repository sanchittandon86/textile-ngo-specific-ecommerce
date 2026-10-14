import { apiFetch } from "./client";
import type { Category } from "./types";

export function getCategories(): Promise<Category[]> {
  return apiFetch<Category[]>("/api/categories");
}
