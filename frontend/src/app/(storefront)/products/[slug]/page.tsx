import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductBySlug, getProducts } from "@/lib/api/products";
import { getCategories } from "@/lib/api/categories";
import { ApiError } from "@/lib/api/client";
import { Container } from "@/components/ui/Container";
import { ProductImage } from "@/components/ui/ProductImage";
import { ProductCard } from "@/components/product/ProductCard";
import { AddToCartForm } from "@/components/product/AddToCartForm";
import { formatMoney } from "@/lib/format";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

async function loadProduct(slug: string) {
  try {
    return await getProductBySlug(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const product = await getProductBySlug(slug);
    return {
      title: product.name,
      description:
        product.description ?? `${product.name} -- handcrafted textile.`,
    };
  } catch {
    return { title: "Product" };
  }
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await loadProduct(slug);

  // Related products: the product detail response only exposes
  // category_id (not the category's slug, which /api/products requires
  // for filtering), so categories are fetched to resolve id -> slug
  // using only existing endpoints.
  let related: Awaited<ReturnType<typeof getProducts>>["products"] = [];

  if (product.category_id) {
    try {
      const categories = await getCategories();
      const category = categories.find((c) => c.id === product.category_id);

      if (category) {
        const result = await getProducts({ category: category.slug, limit: 5 });
        related = result.products.filter((p) => p.id !== product.id).slice(0, 4);
      }
    } catch {
      // Related products are a nice-to-have; failures here shouldn't
      // break the product page itself.
    }
  }

  return (
    <Container className="py-10 sm:py-14">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          className="aspect-square w-full"
        />

        <div>
          <h1 className="font-serif text-3xl text-ink">{product.name}</h1>
          <p className="mt-3 text-xl text-ink-muted">
            {formatMoney(product.price)}
          </p>

          {product.description && (
            <p className="mt-6 max-w-md text-sm leading-relaxed text-ink-muted">
              {product.description}
            </p>
          )}

          <div className="mt-8">
            <AddToCartForm product={product} />
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-20 border-t border-beige pt-14">
          <h2 className="font-serif text-2xl text-ink">You May Also Like</h2>
          <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}
    </Container>
  );
}
