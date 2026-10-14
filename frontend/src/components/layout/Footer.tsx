import Link from "next/link";
import { getCategories } from "@/lib/api/categories";
import { Container } from "@/components/ui/Container";
import type { Category } from "@/lib/api/types";

const SOCIAL_LINKS = [
  { label: "Instagram", href: "#" },
  { label: "Pinterest", href: "#" },
  { label: "Facebook", href: "#" },
];

const POLICY_LINKS = [
  { label: "Shipping Policy", href: "#" },
  { label: "Returns & Exchanges", href: "#" },
  { label: "Privacy Policy", href: "#" },
  { label: "Terms of Service", href: "#" },
];

export async function Footer() {
  let categories: Category[] = [];

  try {
    categories = await getCategories();
  } catch {
    // Non-fatal: the footer still renders without category links.
  }

  return (
    <footer className="bg-olive-900 text-sage-100">
      <Container className="grid grid-cols-1 gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="font-serif text-xl text-ivory">Aaranya</span>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-sage-100/80">
            Handcrafted textiles for a calmer home, made with skilled
            artisans across India.
          </p>
        </div>

        <div>
          <h3 className="text-xs font-medium tracking-[0.14em] text-ivory uppercase">
            Shop
          </h3>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-sage-100/80">
            <li>
              <Link href="/products" className="transition-colors hover:text-ivory">
                All Products
              </Link>
            </li>
            <li>
              <Link href="/cart" className="transition-colors hover:text-ivory">
                Cart
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-medium tracking-[0.14em] text-ivory uppercase">
            Categories
          </h3>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-sage-100/80">
            {categories.length === 0 && (
              <li className="text-sage-100/50">Coming soon</li>
            )}
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/products?category=${category.slug}`}
                  className="transition-colors hover:text-ivory"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-medium tracking-[0.14em] text-ivory uppercase">
            Contact
          </h3>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-sage-100/80">
            <li>hello@aaranyatextiles.example</li>
            <li>+91 00000 00000</li>
          </ul>

          <div className="mt-5 flex gap-4 text-xs tracking-wide text-sage-100/80 uppercase">
            {SOCIAL_LINKS.map((social) => (
              <a
                key={social.label}
                href={social.href}
                className="transition-colors hover:text-ivory"
              >
                {social.label}
              </a>
            ))}
          </div>
        </div>
      </Container>

      <div className="border-t border-sage-100/15">
        <Container className="flex flex-col items-center justify-between gap-3 py-5 text-xs text-sage-100/60 sm:flex-row">
          <p>© {new Date().getFullYear()} Aaranya Textiles &amp; Living.</p>
          <div className="flex flex-wrap justify-center gap-4">
            {POLICY_LINKS.map((policy) => (
              <a key={policy.label} href={policy.href} className="transition-colors hover:text-ivory">
                {policy.label}
              </a>
            ))}
          </div>
        </Container>
      </div>
    </footer>
  );
}
