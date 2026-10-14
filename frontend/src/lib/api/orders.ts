import { apiFetch } from "./client";
import type { OrderDetail } from "./types";

export function getOrder(
  orderNumber: string,
  orderToken: string
): Promise<OrderDetail> {
  return apiFetch<OrderDetail>(`/api/orders/${encodeURIComponent(orderNumber)}`, {
    headers: { "X-Order-Token": orderToken },
  });
}
