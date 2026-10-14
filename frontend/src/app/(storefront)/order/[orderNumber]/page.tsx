"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getOrder } from "@/lib/api/orders";
import { getOrderToken } from "@/lib/orderToken";
import { ApiError } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import type { OrderDetail, OrderStatus, PaymentStatus } from "@/lib/api/types";

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting Payment",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  paid_fulfillment_blocked: "Processing",
};

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Payment Pending",
  paid: "Paid",
  failed: "Payment Failed",
  refunded: "Refunded",
};

type LoadState = "loading" | "loaded" | "no-token" | "not-found" | "error";

export default function OrderConfirmationPage() {
  const params = useParams<{ orderNumber: string }>();
  const orderNumber = params.orderNumber;

  const [state, setState] = useState<LoadState>("loading");
  const [order, setOrder] = useState<OrderDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    const token = getOrderToken(orderNumber);

    (token ? getOrder(orderNumber, token) : Promise.resolve(null))
      .then((result) => {
        if (cancelled) return;

        if (!token) {
          setState("no-token");
          return;
        }

        setOrder(result);
        setState("loaded");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 401)) {
          setState("not-found");
        } else {
          setState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [orderNumber]);

  if (state === "loading") {
    return (
      <Container className="py-14">
        <div className="h-8 w-56 animate-pulse bg-beige" />
        <div className="mt-6 h-40 w-full max-w-xl animate-pulse bg-beige" />
      </Container>
    );
  }

  if (state === "no-token") {
    return (
      <Container className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="font-serif text-2xl text-ink">
          We couldn&apos;t locate this order on this device
        </h1>
        <p className="max-w-sm text-sm text-ink-muted">
          Order confirmations are only accessible from the device and
          browser used at checkout. Your order number is{" "}
          <span className="text-ink">{orderNumber}</span>.
        </p>
        <ButtonLink href="/products">Continue Shopping</ButtonLink>
      </Container>
    );
  }

  if (state === "not-found") {
    return (
      <Container className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="font-serif text-2xl text-ink">Order not found</h1>
        <p className="max-w-sm text-sm text-ink-muted">
          We couldn&apos;t find an order matching this link.
        </p>
        <ButtonLink href="/products">Continue Shopping</ButtonLink>
      </Container>
    );
  }

  if (state === "error" || !order) {
    return (
      <Container className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="font-serif text-2xl text-ink">
          Something went wrong
        </h1>
        <p className="max-w-sm text-sm text-ink-muted">
          Please refresh this page in a moment. Your order number is{" "}
          <span className="text-ink">{orderNumber}</span>.
        </p>
      </Container>
    );
  }

  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium tracking-[0.16em] text-olive-700 uppercase">
          Thank you
        </p>
        <h1 className="mt-3 font-serif text-3xl text-ink">
          Your order is confirmed.
        </h1>
        <p className="mt-3 text-sm text-ink-muted">
          Order <span className="text-ink">{order.orderNumber}</span>
        </p>
      </div>

      <div className="mx-auto mt-10 max-w-2xl border border-beige p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-beige pb-5">
          <div>
            <p className="text-xs tracking-wide text-ink-muted uppercase">
              Order Status
            </p>
            <p className="mt-1 text-sm text-ink">
              {ORDER_STATUS_LABELS[order.status]}
            </p>
          </div>
          <div>
            <p className="text-xs tracking-wide text-ink-muted uppercase">
              Payment Status
            </p>
            <p className="mt-1 text-sm text-ink">
              {PAYMENT_STATUS_LABELS[order.paymentStatus]}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="font-serif text-lg text-ink">Items</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {order.items.map((item, index) => (
              <li
                key={`${item.productId ?? item.name}-${index}`}
                className="flex justify-between text-sm"
              >
                <span className="text-ink-muted">
                  {item.name} × {item.quantity}
                </span>
                <span className="text-ink">{formatMoney(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
        </div>

        <dl className="mt-6 flex flex-col gap-2 border-t border-beige pt-5 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Subtotal</dt>
            <dd className="text-ink">
              {formatMoney(order.subtotal, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Shipping</dt>
            <dd className="text-ink">
              {formatMoney(order.shippingFee, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between text-base">
            <dt className="font-medium text-ink">Total</dt>
            <dd className="font-medium text-ink">
              {formatMoney(order.totalAmount, order.currency)}
            </dd>
          </div>
        </dl>

        <div className="mt-6 border-t border-beige pt-5">
          <h2 className="font-serif text-lg text-ink">Shipping To</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {order.customer.name}
            <br />
            {order.shippingAddress.line1}
            {order.shippingAddress.line2 && (
              <>
                <br />
                {order.shippingAddress.line2}
              </>
            )}
            <br />
            {order.shippingAddress.city}, {order.shippingAddress.state}{" "}
            {order.shippingAddress.postalCode}
            <br />
            {order.shippingAddress.country}
          </p>
        </div>
      </div>

      <div className="mt-10 flex justify-center">
        <ButtonLink href="/products">Continue Shopping</ButtonLink>
      </div>
    </Container>
  );
}
