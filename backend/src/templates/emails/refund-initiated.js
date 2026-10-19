const { escapeHtml, formatMoney, renderLayout } = require("./_shared");

// `refund` is caller-supplied ({ amount, refundId }) -- there is no
// refund table in the schema yet (see notification.service.js); this
// template is implemented and tested, but not wired to any trigger
// until a real refund workflow exists.
function render({ order, refund }) {
  const subject = `Refund initiated for your Aaranya order #${order.order_number}`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(order.customer_name)},</p>
    <p style="margin:0 0 16px 0;">We've initiated a refund for your order. It may take a few business days to reflect in your account.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; color:#6b6657; margin: 16px 0;">
      <tr><td>Order number</td><td style="text-align:right; color:#2e3122;">${escapeHtml(order.order_number)}</td></tr>
      <tr><td>Refund amount</td><td style="text-align:right; color:#2e3122;">${formatMoney(refund.amount, order.currency)}</td></tr>
    </table>
  `;

  const text = [
    `Hi ${order.customer_name},`,
    `Refund initiated for your Aaranya order #${order.order_number}.`,
    `Refund amount: ${formatMoney(refund.amount, order.currency)}`,
  ].join("\n");

  return { subject, html: renderLayout({ previewText: subject, bodyHtml }), text };
}

module.exports = { render };
