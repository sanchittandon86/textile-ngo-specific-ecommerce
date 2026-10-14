"use client";

import { useState } from "react";
import { useCart } from "@/lib/cart/CartProvider";
import type { Product } from "@/lib/api/types";

export function AddToCartForm({ product }: { product: Product }) {
  const { addItem, isMutating } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);

  const inStock = product.stock_quantity > 0;
  const maxQuantity = Math.min(product.stock_quantity, 999);

  function adjust(delta: number) {
    setQuantity((current) => Math.min(maxQuantity, Math.max(1, current + delta)));
  }

  async function handleAddToCart() {
    setFeedback(null);

    try {
      await addItem(product.id, quantity);
      setFeedback("success");
    } catch {
      setFeedback("error");
    }
  }

  if (!inStock) {
    return (
      <p className="text-sm font-medium tracking-wide text-terracotta-600 uppercase">
        Out of Stock
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center border border-beige-dark">
          <button
            type="button"
            onClick={() => adjust(-1)}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
            className="flex h-11 w-11 items-center justify-center text-ink transition-colors hover:bg-cream disabled:opacity-40"
          >
            −
          </button>
          <span className="w-10 text-center text-sm">{quantity}</span>
          <button
            type="button"
            onClick={() => adjust(1)}
            disabled={quantity >= maxQuantity}
            aria-label="Increase quantity"
            className="flex h-11 w-11 items-center justify-center text-ink transition-colors hover:bg-cream disabled:opacity-40"
          >
            +
          </button>
        </div>

        <span className="text-xs text-ink-muted">
          {product.stock_quantity} available
        </span>
      </div>

      <button
        type="button"
        onClick={handleAddToCart}
        disabled={isMutating}
        className="w-full max-w-xs bg-olive-700 py-3.5 text-xs font-medium tracking-[0.14em] text-ivory uppercase transition-colors hover:bg-olive-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-12"
      >
        {isMutating ? "Adding..." : "Add to Cart"}
      </button>

      {feedback === "success" && (
        <p className="text-xs tracking-wide text-olive-700">
          Added to your cart.
        </p>
      )}
      {feedback === "error" && (
        <p className="text-xs tracking-wide text-terracotta-600">
          Couldn&apos;t add this item. Please try again.
        </p>
      )}
    </div>
  );
}
