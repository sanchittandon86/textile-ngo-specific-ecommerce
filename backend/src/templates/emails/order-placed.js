const { escapeHtml, formatMoney, renderLayout, renderItemsTable, renderButton } = require("./_shared");

// `order` is the raw orders row (snake_case DB columns); `items` is the
// order_items rows; `trackingUrl` is optional -- omitted until a secure
// guest-tracking URL mechanism exists (see notification.service.js).
function render({ order, items, trackingUrl }) {
  const subject = `Your Aaranya order #${order.order_number} has been placed`;

  const orderDate = new Date(order.created_at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(order.customer_name)},</p>
    <p style="margin:0 0 16px 0;">Thank you for your order. We've received it and will begin preparing it shortly.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; color:#6b6657; margin: 16px 0;">
      <tr><td>Order number</td><td style="text-align:right; color:#2e3122;">${escapeHtml(order.order_number)}</td></tr>
      <tr><td>Order date</td><td style="text-align:right; color:#2e3122;">${escapeHtml(orderDate)}</td></tr>
    </table>

    <h3 style="font-size:13px; letter-spacing:0.08em; text-transform:uppercase; color:#6b6657; margin: 24px 0 4px 0;">Items</h3>
    ${renderItemsTable(items, order.currency)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px; margin-top: 8px;">
      <tr><td style="color:#6b6657;">Subtotal</td><td style="text-align:right;">${formatMoney(order.subtotal, order.currency)}</td></tr>
      <tr><td style="color:#6b6657;">Shipping</td><td style="text-align:right;">${formatMoney(order.shipping_fee, order.currency)}</td></tr>
      <tr><td style="font-weight:bold; padding-top:8px;">Total</td><td style="text-align:right; font-weight:bold; padding-top:8px;">${formatMoney(order.total_amount, order.currency)}</td></tr>
    </table>

    <h3 style="font-size:13px; letter-spacing:0.08em; text-transform:uppercase; color:#6b6657; margin: 24px 0 4px 0;">Shipping Address</h3>
    <p style="margin:0; color:#2e3122;">
      ${escapeHtml(order.customer_name)}<br />
      ${escapeHtml(order.shipping_address_line1)}${order.shipping_address_line2 ? `<br />${escapeHtml(order.shipping_address_line2)}` : ""}<br />
      ${escapeHtml(order.shipping_city)}, ${escapeHtml(order.shipping_state)} ${escapeHtml(order.shipping_postal_code)}<br />
      ${escapeHtml(order.shipping_country)}
    </p>

    ${renderButton(trackingUrl, "Track Your Order")}
  `;

  const text = [
    `Hi ${order.customer_name},`,
    `Your Aaranya order #${order.order_number} has been placed.`,
    `Order date: ${orderDate}`,
    "",
    "Items:",
    ...items.map((i) => `  ${i.product_name} x${i.quantity} - ${formatMoney(i.line_total, order.currency)}`),
    "",
    `Subtotal: ${formatMoney(order.subtotal, order.currency)}`,
    `Shipping: ${formatMoney(order.shipping_fee, order.currency)}`,
    `Total: ${formatMoney(order.total_amount, order.currency)}`,
    "",
    "Shipping address:",
    `${order.customer_name}`,
    `${order.shipping_address_line1}${order.shipping_address_line2 ? ", " + order.shipping_address_line2 : ""}`,
    `${order.shipping_city}, ${order.shipping_state} ${order.shipping_postal_code}`,
    `${order.shipping_country}`,
    trackingUrl ? `\nTrack your order: ${trackingUrl}` : "",
  ].join("\n");

  return { subject, html: renderLayout({ previewText: subject, bodyHtml }), text };
}

module.exports = { render };
