"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getDashboardSummary,
  getAnalytics,
  type DashboardSummary,
  type AnalyticsData,
  type AnalyticsDays,
} from "@/lib/api/admin";
import { formatMoney } from "@/lib/format";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const OLIVE = "#4b5138";
const SAGE = "#9fae86";
const DAY_OPTIONS: AnalyticsDays[] = [7, 30, 90];

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

function formatChartDate(dateStr: string): string {
  const [, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function AnalyticsSection() {
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getAnalytics(days)
      .then((result) => {
        if (!cancelled) setAnalytics(result);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load analytics.");
      });

    return () => {
      cancelled = true;
    };
  }, [days]);

  const revenueChartData = analytics?.revenueByDay.map((d) => ({
    date: formatChartDate(d.date),
    revenue: Number(d.revenue),
  }));

  const ordersChartData = analytics?.ordersByDay.map((d) => ({
    date: formatChartDate(d.date),
    count: d.count,
  }));

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl text-ink">Analytics</h2>
        <div className="flex border border-beige-dark">
          {DAY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              className={`px-3 py-1.5 text-xs font-medium tracking-wide uppercase transition-colors ${
                days === option
                  ? "bg-olive-700 text-ivory"
                  : "bg-ivory text-ink-muted hover:text-ink"
              }`}
            >
              {option}d
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-terracotta-600">{error}</p>}

      {!error && !analytics && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-64 animate-pulse border border-beige bg-beige/40" />
          <div className="h-64 animate-pulse border border-beige bg-beige/40" />
        </div>
      )}

      {analytics && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="border border-beige p-5">
              <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                Revenue (last {days} days)
              </p>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4ded2" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8a8372" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#8a8372" }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip
                      formatter={(value) => formatMoney(String(value))}
                      contentStyle={{ fontSize: 12, border: "1px solid #e4ded2" }}
                    />
                    <Area type="monotone" dataKey="revenue" stroke={OLIVE} fill={OLIVE} fillOpacity={0.15} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="border border-beige p-5">
              <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                Orders (last {days} days)
              </p>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ordersChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4ded2" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8a8372" }} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#8a8372" }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                      allowDecimals={false}
                    />
                    <Tooltip contentStyle={{ fontSize: 12, border: "1px solid #e4ded2" }} />
                    <Bar dataKey="count" fill={SAGE} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="mt-4 border border-beige">
            <p className="border-b border-beige bg-cream px-5 py-3 text-xs font-medium tracking-wide text-ink-muted uppercase">
              Top Products (last {days} days)
            </p>
            {analytics.topProducts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">No paid orders in this period.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs tracking-wide text-ink-muted uppercase">
                  <tr>
                    <th className="px-5 py-2 font-medium">Product</th>
                    <th className="px-5 py-2 font-medium">Units Sold</th>
                    <th className="px-5 py-2 font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.topProducts.map((product, index) => (
                    <tr key={index} className="border-t border-beige">
                      <td className="px-5 py-2.5 text-ink">
                        {product.slug ? (
                          <Link href={`/products/${product.slug}`} className="hover:text-olive-700">
                            {product.name}
                          </Link>
                        ) : (
                          product.name
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-ink-muted">{product.quantitySold}</td>
                      <td className="px-5 py-2.5 text-ink-muted">{formatMoney(product.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
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

          <AnalyticsSection />
        </>
      )}
    </div>
  );
}
