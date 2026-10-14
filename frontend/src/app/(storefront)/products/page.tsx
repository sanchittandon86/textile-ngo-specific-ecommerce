import type { Metadata } from "next";
import { getCategories } from "@/lib/api/categories";
import { getProducts, searchProducts } from "@/lib/api/products";
import { Container } from "@/components/ui/Container";
import { ProductCard } from "@/components/product/ProductCard";
import { ProductFilters } from "@/components/products/ProductFilters";
import { Pagination } from "@/components/products/Pagination";
import type { ProductSortBy, SortOrder } from "@/lib/api/types";

export const metadata: Metadata = {
  title: "Shop All Products",
  description: "Browse handcrafted bedsheets, pillow covers, bags and more.",
};

const VALID_SORT_BY: ProductSortBy[] = ["name", "price", "created_at"];
const VALID_ORDER: SortOrder[] = ["asc", "desc"];
const PAGE_SIZE = 12;

interface ProductsPageProps {
  searchParams: Promise<{
    page?: string;
    category?: string;
    sortBy?: string;
    order?: string;
    q?: string;
  }>;
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const params = await searchParams;
  const query = params.q?.trim();

  const categories = await getCategories().catch(() => []);

  // The backend's search endpoint is a separate, simpler endpoint -- it
  // doesn't support category/sort/pagination at the same time as a text
  // query, so a search in progress intentionally shows a flat result set
  // rather than pretending those controls still apply.
  if (query) {
    let products: Awaited<ReturnType<typeof searchProducts>>["products"] = [];
    let count = 0;
    let loadError: string | null = null;

    try {
      const result = await searchProducts(query);
      products = result.products;
      count = result.count;
    } catch {
      loadError = "Unable to search products right now. Please try again.";
    }

    return (
      <Container className="py-10 sm:py-14">
        <h1 className="font-serif text-3xl text-ink">Search Results</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {loadError ? "" : `${count} result${count === 1 ? "" : "s"} for "${query}"`}
        </p>

        <div className="mt-8">
          <ProductFilters categories={categories} />
        </div>

        {loadError && (
          <p className="mt-10 text-sm text-terracotta-600">{loadError}</p>
        )}

        {!loadError && products.length === 0 && (
          <p className="mt-10 text-sm text-ink-muted">
            No products matched “{query}”. Try a different search term.
          </p>
        )}

        {!loadError && products.length > 0 && (
          <div className="mt-10 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </Container>
    );
  }

  const page = Math.max(1, Number(params.page) || 1);
  const sortBy = VALID_SORT_BY.includes(params.sortBy as ProductSortBy)
    ? (params.sortBy as ProductSortBy)
    : "created_at";
  const order = VALID_ORDER.includes(params.order as SortOrder)
    ? (params.order as SortOrder)
    : "desc";

  let products: Awaited<ReturnType<typeof getProducts>>["products"] = [];
  let pagination: Awaited<ReturnType<typeof getProducts>>["pagination"] | null = null;
  let loadError: string | null = null;

  try {
    const result = await getProducts({
      page,
      limit: PAGE_SIZE,
      category: params.category,
      sortBy,
      order,
    });
    products = result.products;
    pagination = result.pagination;
  } catch {
    loadError = "Unable to load products right now. Please try again shortly.";
  }

  function buildHref(targetPage: number) {
    const qs = new URLSearchParams();
    if (params.category) qs.set("category", params.category);
    qs.set("sortBy", sortBy);
    qs.set("order", order);
    qs.set("page", String(targetPage));
    return `/products?${qs}`;
  }

  return (
    <Container className="py-10 sm:py-14">
      <h1 className="font-serif text-3xl text-ink">Shop All</h1>

      <div className="mt-8">
        <ProductFilters categories={categories} />
      </div>

      {loadError && (
        <p className="mt-10 text-sm text-terracotta-600">{loadError}</p>
      )}

      {!loadError && products.length === 0 && (
        <p className="mt-10 text-sm text-ink-muted">
          No products found for this selection.
        </p>
      )}

      {!loadError && products.length > 0 && (
        <>
          <div className="mt-10 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>

          {pagination && <Pagination pagination={pagination} buildHref={buildHref} />}
        </>
      )}
    </Container>
  );
}
