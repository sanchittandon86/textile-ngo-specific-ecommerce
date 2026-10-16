"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getAdminOrderDetail,
  markOrderShipped,
  markOrderDelivered,
  AdminApiError,
  type AdminOrderDetail,
} from "@/lib/api/admin";
import { formatMoney } from "@/lib/format";

function FulfillmentPanel({
  detail,
  onUpdated,
}: {
  detail: AdminOrderDetail;
  onUpdated: (order: AdminOrderDetail["order"]) => void;
}) {
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [showShipForm, setShowShipForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { status } = detail.order;

  async function handleMarkShipped(event: React.FormEvent) {
    event.preventDefault();
    setActionError(null);
    setSubmitting(true);

    try {
      const updated = await markOrderShipped(detail.order.order_number, carrier.trim(), trackingNumber.trim());
      onUpdated(updated);
      setShowShipForm(false);
    } catch (error) {
      setActionError(error instanceof AdminApiError ? error.message : "Unable to update this order.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkDelivered() {
    setActionError(null);
    setSubmitting(true);

    try {
      const updated = await markOrderDelivered(detail.order.order_number);
      onUpdated(updated);
    } catch (error) {
      setActionError(error instanceof AdminApiError ? error.message : "Unable to update this order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 border border-beige">
      <h2 className="border-b border-beige bg-cream px-5 py-3 text-sm font-medium text-ink">Fulfillment</h2>
      <div className="px-5 py-4">
        {detail.order.tracking_carrier && detail.order.tracking_number && (
          <p className="text-sm text-ink-muted">
            Shipped via <span className="text-ink">{detail.order.tracking_carrier}</span> — tracking{" "}
            <span className="text-ink">{detail.order.tracking_number}</span>
          </p>
        )}

        {status === "processing" && !showShipForm && (
          <button
            type="button"
            onClick={() => setShowShipForm(true)}
            className="bg-olive-700 px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-ivory uppercase transition-colors hover:bg-olive-800"
          >
            Mark as Shipped
          </button>
        )}

        {status === "processing" && showShipForm && (
          <form onSubmit={handleMarkShipped} className="flex flex-col gap-3">
            <div>
              <label className="text-xs tracking-wide text-ink-muted uppercase">Carrier</label>
              <input
                type="text"
                required
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
                placeholder="e.g. BlueDart"
                className="mt-1 w-full border border-beige-dark bg-ivory px-3 py-2 text-sm text-ink focus:border-olive-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs tracking-wide text-ink-muted uppercase">Tracking Number</label>
              <input
                type="text"
                required
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                className="mt-1 w-full border border-beige-dark bg-ivory px-3 py-2 text-sm text-ink focus:border-olive-600 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={submitting}
                className="bg-olive-700 px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-ivory uppercase transition-colors hover:bg-olive-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Confirm Shipped"}
              </button>
              <button
                type="button"
                onClick={() => setShowShipForm(false)}
                disabled={submitting}
                className="text-xs tracking-wide text-ink-muted uppercase hover:text-olive-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {status === "shipped" && (
          <button
            type="button"
            onClick={handleMarkDelivered}
            disabled={submitting}
            className="mt-3 bg-olive-700 px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-ivory uppercase transition-colors hover:bg-olive-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Mark as Delivered"}
          </button>
        )}

        {status !== "processing" && status !== "shipped" && (
          <p className="text-sm text-ink-muted">
            {status === "delivered"
              ? "This order has been delivered."
              : "No fulfillment action is available for this order's current status."}
          </p>
        )}

        {actionError && <p className="mt-3 text-sm text-terracotta-600">{actionError}</p>}

        {detail.statusHistory.length > 0 && (
          <div className="mt-5 border-t border-beige pt-4">
            <h3 className="text-xs tracking-wide text-ink-muted uppercase">History</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-muted">
              {detail.statusHistory.map((event) => (
                <li key={event.id}>
                  {event.from_status ? `${event.from_status} → ${event.to_status}` : event.to_status} —{" "}
                  {new Date(event.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminOrderDetailPage() {
  const params = useParams<{ orderNumber: string }>();
  const orderNumber = params.orderNumber;

  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getAdminOrderDetail(orderNumber)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load this order.");
      });

    return () => {
      cancelled = true;
    };
  }, [orderNumber]);

  function handleFulfillmentUpdated(updatedOrder: AdminOrderDetail["order"]) {
    setDetail((current) => {
      if (!current) return current;
      return {
        ...current,
        order: { ...current.order, ...updatedOrder },
        statusHistory: [
          ...current.statusHistory,
          {
            id: `local-${Date.now()}`,
            from_status: current.order.status,
            to_status: updatedOrder.status,
            created_at: new Date().toISOString(),
          },
        ],
      };
    });
  }

  return (
    <div>
      <Link href="/admin/orders" className="text-xs tracking-wide text-ink-muted uppercase hover:text-olive-700">
        ← Back to Orders
      </Link>

      <h1 className="mt-3 font-serif text-2xl text-ink">{orderNumber}</h1>

      {error && <p className="mt-4 text-sm text-terracotta-600">{error}</p>}

      {!error && !detail && (
        <div className="mt-6 h-64 animate-pulse border border-beige bg-beige/40" />
      )}

      {detail && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="border border-beige">
              <div className="flex flex-wrap gap-6 border-b border-beige bg-cream px-5 py-4">
                <div>
                  <p className="text-xs tracking-wide text-ink-muted uppercase">Order Status</p>
                  <p className="mt-1 text-sm text-ink capitalize">
                    {detail.order.status.replace(/_/g, " ")}
                  </p>
                </div>
                <div>
                  <p className="text-xs tracking-wide text-ink-muted uppercase">Payment Status</p>
                  <p className="mt-1 text-sm text-ink capitalize">{detail.order.payment_status}</p>
                </div>
                <div>
                  <p className="text-xs tracking-wide text-ink-muted uppercase">Payment Method</p>
                  <p className="mt-1 text-sm text-ink capitalize">{detail.order.payment_method}</p>
                </div>
              </div>

              <div className="px-5 py-4">
                <h2 className="text-sm font-medium text-ink">Items</h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {detail.items.map((item, index) => (
                    <li key={index} className="flex justify-between text-sm">
                      <span className="text-ink-muted">
                        {item.product_name} × {item.quantity}
                      </span>
                      <span className="text-ink">{formatMoney(item.line_total, detail.order.currency)}</span>
                    </li>
                  ))}
                </ul>

                <dl className="mt-4 flex flex-col gap-2 border-t border-beige pt-4 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Subtotal</dt>
                    <dd className="text-ink">{formatMoney(detail.order.subtotal, detail.order.currency)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Shipping</dt>
                    <dd className="text-ink">{formatMoney(detail.order.shipping_fee, detail.order.currency)}</dd>
                  </div>
                  <div className="flex justify-between text-base">
                    <dt className="font-medium text-ink">Total</dt>
                    <dd className="font-medium text-ink">
                      {formatMoney(detail.order.total_amount, detail.order.currency)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <FulfillmentPanel detail={detail} onUpdated={handleFulfillmentUpdated} />

            {detail.payments.length > 0 && (
              <div className="mt-6 border border-beige">
                <h2 className="border-b border-beige bg-cream px-5 py-3 text-sm font-medium text-ink">
                  Payment Attempts
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="text-xs tracking-wide text-ink-muted uppercase">
                      <tr>
                        <th className="px-5 py-2 font-medium">Razorpay Payment ID</th>
                        <th className="px-5 py-2 font-medium">Status</th>
                        <th className="px-5 py-2 font-medium">Failure Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.payments.map((payment) => (
                        <tr key={payment.id} className="border-t border-beige">
                          <td className="px-5 py-2 text-ink-muted">
                            {payment.razorpay_payment_id ?? "--"}
                          </td>
                          <td className="px-5 py-2 text-ink-muted capitalize">{payment.status}</td>
                          <td className="px-5 py-2 text-ink-muted">
                            {payment.failure_reason ?? "--"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="border border-beige p-5">
            <h2 className="text-sm font-medium text-ink">Customer</h2>
            <p className="mt-2 text-sm text-ink-muted">
              {detail.order.customer_name}
              <br />
              {detail.order.customer_phone}
              {detail.order.customer_email && (
                <>
                  <br />
                  {detail.order.customer_email}
                </>
              )}
            </p>

            <h2 className="mt-5 text-sm font-medium text-ink">Shipping Address</h2>
            <p className="mt-2 text-sm text-ink-muted">
              {detail.order.shipping_address_line1}
              {detail.order.shipping_address_line2 && (
                <>
                  <br />
                  {detail.order.shipping_address_line2}
                </>
              )}
              <br />
              {detail.order.shipping_city}, {detail.order.shipping_state}{" "}
              {detail.order.shipping_postal_code}
              <br />
              {detail.order.shipping_country}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
