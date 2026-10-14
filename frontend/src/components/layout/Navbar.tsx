import Link from "next/link";
import { getCategories } from "@/lib/api/categories";
import { Container } from "@/components/ui/Container";
import { NavbarClient } from "./NavbarClient";
import type { Category } from "@/lib/api/types";

export async function Navbar() {
  let categories: Category[] = [];

  try {
    categories = await getCategories();
  } catch {
    // Non-fatal: the storefront should still render without categories.
  }

  return (
    <header className="sticky top-0 z-40 border-b border-beige bg-ivory/95 backdrop-blur-sm">
      <Container className="flex h-20 items-center justify-between">
        <Link href="/" className="flex flex-col leading-none">
          <span className="font-serif text-xl tracking-wide text-ink">
            Aaranya
          </span>
          <span className="text-[10px] tracking-[0.3em] text-ink-muted uppercase">
            Textiles &amp; Living
          </span>
        </Link>

        <NavbarClient categories={categories} />
      </Container>
    </header>
  );
}
