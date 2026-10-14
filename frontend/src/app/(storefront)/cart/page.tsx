"use client";

import { useCart } from "@/lib/cart/CartProvider";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { CartLineItem } from "@/components/cart/CartLineItem";
import { CartSummary } from "@/components/cart/CartSummary";

export default function CartPage() {
  const { cart, cartToken, isLoading, isMutating, clearCart, error } = useCart();

  if (isLoading) {
    return (
      <Container className="py-10 sm:py-14">
        <div className="h-9 w-40 animate-pulse bg-beige" />
        <div className="mt-8 flex flex-col gap-6">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-28 w-full animate-pulse bg-beige" />
          ))}
        </div>
      </Container>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <Container className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="font-serif text-2xl text-ink">Your cart is empty</h1>
        <p className="max-w-sm text-sm text-ink-muted">
          Browse our collection and add something you love.
        </p>
        <ButtonLink href="/products">Continue Shopping</ButtonLink>
      </Container>
    );
  }

  const hasUnavailableItems = cart.items.some((item) => !item.isAvailable);

  return (
    <Container className="py-10 sm:py-14">
      <h1 className="font-serif text-3xl text-ink">Your Cart</h1>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {cart.items.map((item) => (
            <CartLineItem key={item.productId} item={item} />
          ))}

          <button
            type="button"
            onClick={() => clearCart()}
            disabled={isMutating}
            className="mt-6 text-xs tracking-wide text-ink-muted uppercase transition-colors hover:text-terracotta-600 disabled:opacity-40"
          >
            Empty Cart
          </button>

          {error && <p className="mt-4 text-sm text-terracotta-600">{error}</p>}
        </div>

        <div className="h-fit border border-beige p-6">
          <h2 className="font-serif text-lg text-ink">Order Summary</h2>

          <div className="mt-5">
            {cartToken && (
              <CartSummary cartToken={cartToken} cartTotal={cart.total} />
            )}
          </div>

          {hasUnavailableItems && (
            <p className="mt-4 text-xs text-terracotta-600">
              Some items need attention before checkout -- see above.
            </p>
          )}

          <ButtonLink href="/checkout" className="mt-6 w-full">
            Proceed to Checkout
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
