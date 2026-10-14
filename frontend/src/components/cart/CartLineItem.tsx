"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/lib/cart/CartProvider";
import { formatMoney } from "@/lib/format";
import { ProductImage } from "@/components/ui/ProductImage";
import type { CartItem } from "@/lib/api/types";

export function CartLineItem({ item }: { item: CartItem }) {
  const { updateQuantity, removeItem, isMutating } = useCart();
  const [error, setError] = useState<string | null>(null);

  async function handleQuantityChange(nextQuantity: number) {
    if (nextQuantity < 1) return;
    setError(null);

    try {
      await updateQuantity(item.productId, nextQuantity);
    } catch {
      setError("Couldn't update quantity.");
    }
  }

  async function handleRemove() {
    setError(null);

    try {
      await removeItem(item.productId);
    } catch {
      setError("Couldn't remove this item.");
    }
  }

  return (
    <div className="flex gap-4 border-b border-beige py-6 first:pt-0">
      <Link href={`/products/${item.slug}`} className="shrink-0">
        <ProductImage src={item.imageUrl} alt={item.name} className="h-28 w-24" />
      </Link>

      <div className="flex flex-1 flex-col justify-between">
        <div className="flex justify-between gap-4">
          <div>
            <Link href={`/products/${item.slug}`}>
              <h3 className="text-sm text-ink hover:text-olive-700">{item.name}</h3>
            </Link>
            <p className="mt-1 text-sm text-ink-muted">
              {formatMoney(item.unitPrice)}
            </p>
            {!item.isAvailable && (
              <p className="mt-1 text-xs tracking-wide text-terracotta-600 uppercase">
                {item.isPublished
                  ? `Only ${item.availableStock} left -- reduce quantity`
                  : "No longer available"}
              </p>
            )}
          </div>

          <p className="text-sm text-ink">{formatMoney(item.lineTotal)}</p>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center border border-beige-dark">
            <button
              type="button"
              onClick={() => handleQuantityChange(item.quantity - 1)}
              disabled={isMutating || item.quantity <= 1}
              aria-label="Decrease quantity"
              className="flex h-9 w-9 items-center justify-center text-ink transition-colors hover:bg-cream disabled:opacity-40"
            >
              −
            </button>
            <span className="w-8 text-center text-sm">{item.quantity}</span>
            <button
              type="button"
              onClick={() => handleQuantityChange(item.quantity + 1)}
              disabled={isMutating || item.quantity >= item.availableStock}
              aria-label="Increase quantity"
              className="flex h-9 w-9 items-center justify-center text-ink transition-colors hover:bg-cream disabled:opacity-40"
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={handleRemove}
            disabled={isMutating}
            className="text-xs tracking-wide text-ink-muted uppercase transition-colors hover:text-terracotta-600 disabled:opacity-40"
          >
            Remove
          </button>
        </div>

        {error && <p className="mt-2 text-xs text-terracotta-600">{error}</p>}
      </div>
    </div>
  );
}
