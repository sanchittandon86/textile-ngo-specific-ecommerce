import { apiFetch } from "./client";
import type { CartSnapshot, CreateCartData } from "./types";

export function createCart(): Promise<CreateCartData> {
  return apiFetch<CreateCartData>("/api/cart", { method: "POST" });
}

export function getCart(cartToken: string): Promise<CartSnapshot> {
  return apiFetch<CartSnapshot>("/api/cart", {
    headers: { "X-Cart-Token": cartToken },
  });
}

export function addCartItem(
  cartToken: string,
  productId: string | number,
  quantity: number
): Promise<CartSnapshot> {
  return apiFetch<CartSnapshot>("/api/cart/items", {
    method: "POST",
    headers: { "X-Cart-Token": cartToken },
    body: { productId, quantity },
  });
}

export function updateCartItemQuantity(
  cartToken: string,
  productId: string | number,
  quantity: number
): Promise<CartSnapshot> {
  return apiFetch<CartSnapshot>(`/api/cart/items/${productId}`, {
    method: "PATCH",
    headers: { "X-Cart-Token": cartToken },
    body: { quantity },
  });
}

export function removeCartItem(
  cartToken: string,
  productId: string | number
): Promise<CartSnapshot> {
  return apiFetch<CartSnapshot>(`/api/cart/items/${productId}`, {
    method: "DELETE",
    headers: { "X-Cart-Token": cartToken },
  });
}

export function emptyCart(cartToken: string): Promise<CartSnapshot> {
  return apiFetch<CartSnapshot>("/api/cart", {
    method: "DELETE",
    headers: { "X-Cart-Token": cartToken },
  });
}
