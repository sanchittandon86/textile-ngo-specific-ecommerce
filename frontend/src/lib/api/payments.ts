import { apiFetch } from "./client";
import type {
  CreatePaymentOrderResult,
  VerifyPaymentRequest,
  VerifyPaymentResult,
} from "./types";

export function createPaymentOrder(
  orderNumber: string,
  orderToken: string
): Promise<CreatePaymentOrderResult> {
  return apiFetch<CreatePaymentOrderResult>("/api/payments/create-order", {
    method: "POST",
    headers: { "X-Order-Token": orderToken },
    body: { orderNumber },
  });
}

export function verifyPayment(
  orderToken: string,
  payload: VerifyPaymentRequest
): Promise<VerifyPaymentResult> {
  return apiFetch<VerifyPaymentResult>("/api/payments/verify", {
    method: "POST",
    headers: { "X-Order-Token": orderToken },
    body: payload,
  });
}
