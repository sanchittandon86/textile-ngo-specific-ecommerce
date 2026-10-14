"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDashboardSummary, type DashboardSummary } from "@/lib/api/admin";
import { formatMoney } from "@/lib/format";

function StatCard({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const content = (
    <div className="border border-beige bg-cream p-5">
      <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</p>
      <p className="mt-2 font-serif text-2xl text-ink">{value}</p>
    </div>
  );

  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
}

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getDashboardSummary()
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load the dashboard summary.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink">Overview</h1>

      {error && <p className="mt-4 text-sm text-terracotta-600">{error}</p>}

      {!error && !summary && (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse border border-beige bg-beige/40" />
          ))}
        </div>
      )}

      {summary && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total Orders" value={summary.orders.total} href="/admin/orders" />
            <StatCard
              label="Awaiting Payment"
              value={summary.orders.pending_payment}
              href="/admin/orders?status=pending_payment"
            />
            <StatCard
              label="Processing"
              value={summary.orders.processing}
              href="/admin/orders?status=processing"
            />
            <StatCard label="Paid Revenue" value={formatMoney(summary.paidRevenue)} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Products"
              value={`${summary.products.published} / ${summary.products.total} published`}
              href="/admin/products"
            />
            <StatCard
              label="Categories"
              value={`${summary.categories.active} / ${summary.categories.total} active`}
              href="/admin/categories"
            />
            {summary.orders.fulfillment_blocked > 0 && (
              <StatCard
                label="Needs Attention"
                value={`${summary.orders.fulfillment_blocked} order${
                  summary.orders.fulfillment_blocked === 1 ? "" : "s"
                }`}
                href="/admin/orders?status=paid_fulfillment_blocked"
              />
            )}
          </div>

          {summary.orders.fulfillment_blocked > 0 && (
            <p className="mt-6 border border-terracotta-500 bg-terracotta-400/10 px-4 py-3 text-sm text-terracotta-600">
              {summary.orders.fulfillment_blocked} order
              {summary.orders.fulfillment_blocked === 1 ? "" : "s"} were paid but could not be
              fully stocked (oversold). These need manual review -- see Orders, filtered to
              &ldquo;Needs Attention&rdquo;.
            </p>
          )}
        </>
      )}
    </div>
  );
}
