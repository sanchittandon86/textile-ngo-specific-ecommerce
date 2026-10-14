import { getCategories } from "@/lib/api/categories";
import { getProducts } from "@/lib/api/products";
import { Hero } from "@/components/home/Hero";
import { CategorySection } from "@/components/home/CategorySection";
import { BestsellersSection } from "@/components/home/BestsellersSection";
import { TrustBadges } from "@/components/home/TrustBadges";
import { BrandStory } from "@/components/home/BrandStory";
import { CraftsmanshipGallery } from "@/components/home/CraftsmanshipGallery";
import { NewsletterSection } from "@/components/home/NewsletterSection";
import type { Category, Product } from "@/lib/api/types";

export default async function HomePage() {
  let categories: Category[] = [];
  let products: Product[] = [];

  try {
    categories = await getCategories();
  } catch {
    // Section hides itself when empty -- the page should still render.
  }

  try {
    const result = await getProducts({ limit: 8 });
    products = result.products;
  } catch {
    // Section hides itself when empty -- the page should still render.
  }

  return (
    <>
      <Hero />
      <CategorySection categories={categories} />
      <BestsellersSection products={products} />
      <TrustBadges />
      <BrandStory />
      <CraftsmanshipGallery />
      <NewsletterSection />
    </>
  );
}
