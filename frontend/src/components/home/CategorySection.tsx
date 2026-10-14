import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { ProductImage } from "@/components/ui/ProductImage";
import type { Category } from "@/lib/api/types";

export function CategorySection({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null;

  return (
    <section id="categories" className="py-14 sm:py-20">
      <Container>
        <div className="mb-8 flex items-end justify-between">
          <h2 className="font-serif text-2xl text-ink sm:text-3xl">
            Shop by Category
          </h2>
          <Link
            href="/products"
            className="text-xs font-medium tracking-wide text-olive-700 uppercase hover:text-olive-800"
          >
            View all →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/products?category=${category.slug}`}
              className="group block"
            >
              <ProductImage
                src={category.image_url}
                alt={category.name}
                className="aspect-square w-full"
              />
              <p className="mt-3 text-sm text-ink transition-colors group-hover:text-olive-700">
                {category.name}
              </p>
            </Link>
          ))}
        </div>
      </Container>
    </section>
  );
}
