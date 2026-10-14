"use client";

import { useEffect, useState } from "react";
import { getCheckoutSummary } from "@/lib/api/checkout";
import { formatMoney } from "@/lib/format";
import type { CheckoutSummary } from "@/lib/api/types";

// The cart endpoints only return items + total; shipping and the grand
// total are computed by /api/checkout/summary (same backend logic that
// will run again, authoritatively, at actual checkout). Refetched
// whenever the cart's total changes so this stays in sync with mutations.
export function CartSummary({
  cartToken,
  cartTotal,
}: {
  cartToken: string;
  cartTotal: string;
}) {
  const [summary, setSummary] = useState<CheckoutSummary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getCheckoutSummary(cartToken)
      .then((result) => {
        if (cancelled) return;
        setSummary(result);
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
    // cartTotal changing (not just cartToken) is the signal a mutation
    // happened and this summary needs refetching.
  }, [cartToken, cartTotal]);

  if (error) {
    return (
      <p className="text-sm text-terracotta-600">
        Unable to calculate shipping right now.
      </p>
    );
  }

  if (!summary) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-4 w-full animate-pulse bg-beige" />
        <div className="h-4 w-full animate-pulse bg-beige" />
        <div className="h-4 w-full animate-pulse bg-beige" />
      </div>
    );
  }

  return (
    <dl className="flex flex-col gap-3 text-sm">
      <div className="flex justify-between">
        <dt className="text-ink-muted">Subtotal</dt>
        <dd className="text-ink">{formatMoney(summary.subtotal, summary.currency)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-ink-muted">Shipping</dt>
        <dd className="text-ink">
          {formatMoney(summary.shippingFee, summary.currency)}
        </dd>
      </div>
      <div className="flex justify-between border-t border-beige pt-3 text-base">
        <dt className="font-medium text-ink">Total</dt>
        <dd className="font-medium text-ink">
          {formatMoney(summary.estimatedTotal, summary.currency)}
        </dd>
      </div>
    </dl>
  );
}
