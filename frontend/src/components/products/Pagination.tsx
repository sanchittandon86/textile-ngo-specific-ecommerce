import Link from "next/link";
import type { ProductListPagination } from "@/lib/api/types";

export function Pagination({
  pagination,
  buildHref,
}: {
  pagination: ProductListPagination;
  buildHref: (page: number) => string;
}) {
  const { page, totalPages } = pagination;

  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className="mt-12 flex items-center justify-center gap-2"
    >
      <Link
        href={buildHref(page - 1)}
        aria-disabled={page <= 1}
        className={`px-3 py-2 text-xs font-medium tracking-wide uppercase ${
          page <= 1
            ? "pointer-events-none text-ink-soft"
            : "text-ink-muted hover:text-olive-700"
        }`}
      >
        ← Prev
      </Link>

      <span className="text-xs text-ink-muted">
        Page {page} of {totalPages}
      </span>

      <Link
        href={buildHref(page + 1)}
        aria-disabled={page >= totalPages}
        className={`px-3 py-2 text-xs font-medium tracking-wide uppercase ${
          page >= totalPages
            ? "pointer-events-none text-ink-soft"
            : "text-ink-muted hover:text-olive-700"
        }`}
      >
        Next →
      </Link>
    </nav>
  );
}
