"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/lib/cart/CartProvider";
import { formatMoney } from "@/lib/format";
import { ProductImage } from "@/components/ui/ProductImage";
import type { Product } from "@/lib/api/types";

export function ProductCard({ product }: { product: Product }) {
  const { addItem, isMutating } = useCart();
  const [justAdded, setJustAdded] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const inStock = product.stock_quantity > 0;

  async function handleAddToCart() {
    setLocalError(null);

    try {
      await addItem(product.id, 1);
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1800);
    } catch {
      setLocalError("Couldn't add this item. Please try again.");
    }
  }

  return (
    <div className="group flex flex-col">
      <Link href={`/products/${product.slug}`} className="block">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          className="aspect-[4/5] w-full"
        />
      </Link>

      <div className="mt-3 flex flex-1 flex-col">
        <Link href={`/products/${product.slug}`}>
          <h3 className="text-sm text-ink transition-colors group-hover:text-olive-700">
            {product.name}
          </h3>
        </Link>
        <p className="mt-1 text-sm text-ink-muted">
          {formatMoney(product.price)}
        </p>

        {!inStock && (
          <span className="mt-1 text-xs tracking-wide text-terracotta-600 uppercase">
            Out of stock
          </span>
        )}

        <button
          type="button"
          onClick={handleAddToCart}
          disabled={!inStock || isMutating}
          className="mt-3 w-full border border-olive-700 py-2.5 text-[11px] font-medium tracking-[0.12em] text-olive-800 uppercase transition-colors hover:bg-olive-700 hover:text-ivory disabled:cursor-not-allowed disabled:border-beige-dark disabled:text-ink-soft disabled:hover:bg-transparent"
        >
          {justAdded ? "Added" : inStock ? "Add to Cart" : "Unavailable"}
        </button>

        {localError && (
          <p className="mt-1 text-xs text-terracotta-600">{localError}</p>
        )}
      </div>
    </div>
  );
}
