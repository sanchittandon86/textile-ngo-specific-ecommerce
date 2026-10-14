"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/lib/cart/CartProvider";
import type { Category } from "@/lib/api/types";

function CartIcon() {
  const { itemCount } = useCart();

  return (
    <Link
      href="/cart"
      aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
      className="relative flex h-9 w-9 items-center justify-center text-ink transition-colors hover:text-olive-700"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 3h1.5l2.1 12.6a1.5 1.5 0 0 0 1.48 1.25h8.65a1.5 1.5 0 0 0 1.48-1.25L20.25 7.5H6"
        />
        <circle cx="9.5" cy="20" r="1.25" />
        <circle cx="17.5" cy="20" r="1.25" />
      </svg>
      {itemCount > 0 && (
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-terracotta-500 px-1 text-[10px] font-medium text-ivory">
          {itemCount}
        </span>
      )}
    </Link>
  );
}

export function NavbarClient({ categories }: { categories: Category[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-5">
        <nav className="hidden items-center gap-7 text-xs font-medium tracking-[0.08em] text-ink uppercase md:flex">
          <Link href="/" className="transition-colors hover:text-olive-700">
            Home
          </Link>
          <Link href="/products" className="transition-colors hover:text-olive-700">
            Shop
          </Link>
          <div className="group relative">
            <button className="flex items-center gap-1 transition-colors hover:text-olive-700">
              Categories
            </button>
            {categories.length > 0 && (
              <div className="invisible absolute left-0 top-full z-20 w-56 translate-y-1 border border-beige bg-ivory opacity-0 shadow-sm transition-all group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                <ul className="py-2">
                  {categories.map((category) => (
                    <li key={category.id}>
                      <Link
                        href={`/products?category=${category.slug}`}
                        className="block px-4 py-2 text-xs normal-case tracking-normal text-ink-muted transition-colors hover:bg-cream hover:text-olive-800"
                      >
                        {category.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </nav>

        <CartIcon />

        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
          className="flex h-9 w-9 items-center justify-center text-ink md:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-xs flex-col bg-ivory px-6 py-6 shadow-xl">
            <div className="mb-8 flex items-center justify-between">
              <span className="font-serif text-lg text-ink">Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
                className="flex h-9 w-9 items-center justify-center text-ink"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <nav className="flex flex-col gap-1 text-sm font-medium tracking-wide text-ink uppercase">
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className="border-b border-beige py-3 transition-colors hover:text-olive-700"
              >
                Home
              </Link>
              <Link
                href="/products"
                onClick={() => setMobileOpen(false)}
                className="border-b border-beige py-3 transition-colors hover:text-olive-700"
              >
                Shop
              </Link>

              {categories.length > 0 && (
                <div className="border-b border-beige py-3">
                  <p className="mb-2 text-ink">Categories</p>
                  <ul className="flex flex-col gap-2 pl-2">
                    {categories.map((category) => (
                      <li key={category.id}>
                        <Link
                          href={`/products?category=${category.slug}`}
                          onClick={() => setMobileOpen(false)}
                          className="block text-xs normal-case tracking-normal text-ink-muted transition-colors hover:text-olive-800"
                        >
                          {category.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Link
                href="/cart"
                onClick={() => setMobileOpen(false)}
                className="border-b border-beige py-3 transition-colors hover:text-olive-700"
              >
                Cart
              </Link>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
