const { escapeHtml, formatMoney, renderLayout } = require("./_shared");

// `refund` is caller-supplied ({ amount, paymentId, status }) -- see the
// note in refund-initiated.js about this not being wired to a trigger yet.
function render({ order, refund }) {
  const subject = `Your refund for Aaranya order #${order.order_number} is complete`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(order.customer_name)},</p>
    <p style="margin:0 0 16px 0;">Your refund has been completed.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; color:#6b6657; margin: 16px 0;">
      <tr><td>Order number</td><td style="text-align:right; color:#2e3122;">${escapeHtml(order.order_number)}</td></tr>
      <tr><td>Payment ID</td><td style="text-align:right; color:#2e3122;">${escapeHtml(refund.paymentId)}</td></tr>
      <tr><td>Refund amount</td><td style="text-align:right; color:#2e3122;">${formatMoney(refund.amount, order.currency)}</td></tr>
      <tr><td>Status</td><td style="text-align:right; color:#2e3122; text-transform:capitalize;">${escapeHtml(refund.status)}</td></tr>
    </table>
  `;

  const text = [
    `Hi ${order.customer_name},`,
    `Your refund for Aaranya order #${order.order_number} is complete.`,
    `Payment ID: ${refund.paymentId}`,
    `Refund amount: ${formatMoney(refund.amount, order.currency)}`,
    `Status: ${refund.status}`,
  ].join("\n");

  return { subject, html: renderLayout({ previewText: subject, bodyHtml }), text };
}

module.exports = { render };
