// Formats a backend money string (e.g. "1499.00") for display only.
// Never used for calculation -- the backend is always the source of
// truth for totals; this purely renders what it already computed.
export function formatMoney(value: string, currency: string = "INR"): string {
  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return value;
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}
