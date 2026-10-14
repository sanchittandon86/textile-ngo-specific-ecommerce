"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { listAdminOrders, type AdminOrderSummary, type Pagination } from "@/lib/api/admin";
import { formatMoney } from "@/lib/format";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "pending_payment", label: "Awaiting Payment" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "paid_fulfillment_blocked", label: "Needs Attention" },
];

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "delivered" || status === "processing"
      ? "bg-sage-100 text-olive-700"
      : status === "paid_fulfillment_blocked"
        ? "bg-terracotta-400/15 text-terracotta-600"
        : "bg-beige text-ink-muted";

  return (
    <span className={`px-2 py-0.5 text-xs tracking-wide uppercase ${tone}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function AdminOrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [orders, setOrders] = useState<AdminOrderSummary[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listAdminOrders({ page, status: status || undefined })
      .then((result) => {
        if (cancelled) return;
        setOrders(result.orders);
        setPagination(result.pagination);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load orders.");
      });

    return () => {
      cancelled = true;
    };
  }, [page, status]);

  function updateStatus(nextStatus: string) {
    const qs = new URLSearchParams();
    if (nextStatus) qs.set("status", nextStatus);
    router.push(`/admin/orders${qs.toString() ? `?${qs}` : ""}`);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">Orders</h1>

        <select
          value={status}
          onChange={(event) => updateStatus(event.target.value)}
          aria-label="Filter by status"
          className="border border-beige-dark bg-ivory px-3 py-2 text-sm text-ink focus:border-olive-600 focus:outline-none"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-4 text-sm text-terracotta-600">{error}</p>}

      {!error && !orders && (
        <div className="mt-6 h-64 animate-pulse border border-beige bg-beige/40" />
      )}

      {!error && orders && orders.length === 0 && (
        <p className="mt-6 text-sm text-ink-muted">No orders found.</p>
      )}

      {!error && orders && orders.length > 0 && (
        <div className="mt-6 overflow-x-auto border border-beige">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-beige bg-cream text-xs tracking-wide text-ink-muted uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Placed</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-beige last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/orders/${order.order_number}`}
                      className="text-ink hover:text-olive-700"
                    >
                      {order.order_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{order.customer_name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 text-ink-muted capitalize">{order.payment_status}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {formatMoney(order.total_amount, order.currency)}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {new Date(order.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-xs text-ink-muted">
          <button
            type="button"
            onClick={() => {
              const qs = new URLSearchParams(searchParams.toString());
              qs.set("page", String(Math.max(1, page - 1)));
              router.push(`/admin/orders?${qs}`);
            }}
            disabled={page <= 1}
            className="px-2 py-1 uppercase tracking-wide disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            onClick={() => {
              const qs = new URLSearchParams(searchParams.toString());
              qs.set("page", String(Math.min(pagination.totalPages, page + 1)));
              router.push(`/admin/orders?${qs}`);
            }}
            disabled={page >= pagination.totalPages}
            className="px-2 py-1 uppercase tracking-wide disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
