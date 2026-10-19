const { escapeHtml, renderLayout, renderButton } = require("./_shared");

function render({ order, trackingUrl }) {
  const subject = `Your Aaranya order #${order.order_number} has shipped`;
  const hasTracking = Boolean(order.tracking_carrier || order.tracking_number);

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(order.customer_name)},</p>
    <p style="margin:0 0 16px 0;">Good news -- your order is on its way.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; color:#6b6657; margin: 16px 0;">
      <tr><td>Order number</td><td style="text-align:right; color:#2e3122;">${escapeHtml(order.order_number)}</td></tr>
      ${order.tracking_carrier ? `<tr><td>Courier</td><td style="text-align:right; color:#2e3122;">${escapeHtml(order.tracking_carrier)}</td></tr>` : ""}
      ${order.tracking_number ? `<tr><td>Tracking number</td><td style="text-align:right; color:#2e3122;">${escapeHtml(order.tracking_number)}</td></tr>` : ""}
    </table>

    ${!hasTracking ? `<p style="margin:0; color:#6b6657; font-size:13px;">Tracking details will be added once available.</p>` : ""}

    ${renderButton(trackingUrl, "Track Your Order")}
  `;

  const text = [
    `Hi ${order.customer_name},`,
    `Your Aaranya order #${order.order_number} has shipped.`,
    order.tracking_carrier ? `Courier: ${order.tracking_carrier}` : "",
    order.tracking_number ? `Tracking number: ${order.tracking_number}` : "",
    trackingUrl ? `Track your order: ${trackingUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html: renderLayout({ previewText: subject, bodyHtml }), text };
}

module.exports = { render };
