import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { ProductCard } from "@/components/product/ProductCard";
import type { Product } from "@/lib/api/types";

// Note: the products table has no "featured"/"bestseller" flag or sales
// count, so this isn't actually sorted by sales -- it's the default
// product listing (most recently added first). Labeled "Bestsellers" to
// match the brand's merchandising language, same as the reference design.
export function BestsellersSection({ products }: { products: Product[] }) {
  if (products.length === 0) return null;

  return (
    <section className="bg-cream py-14 sm:py-20">
      <Container>
        <div className="mb-8 flex items-end justify-between">
          <h2 className="font-serif text-2xl text-ink sm:text-3xl">
            Bestsellers
          </h2>
          <Link
            href="/products"
            className="text-xs font-medium tracking-wide text-olive-700 uppercase hover:text-olive-800"
          >
            View all →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </Container>
    </section>
  );
}
