import { apiFetch } from "./client";
import type { CheckoutRequest, CheckoutResult, CheckoutSummary } from "./types";

export function getCheckoutSummary(cartToken: string): Promise<CheckoutSummary> {
  return apiFetch<CheckoutSummary>("/api/checkout/summary", {
    headers: { "X-Cart-Token": cartToken },
  });
}

export function createOrder(
  cartToken: string,
  payload: CheckoutRequest
): Promise<CheckoutResult> {
  return apiFetch<CheckoutResult>("/api/checkout", {
    method: "POST",
    headers: { "X-Cart-Token": cartToken },
    body: payload,
  });
}
