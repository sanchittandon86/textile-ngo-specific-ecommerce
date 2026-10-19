const { escapeHtml, formatMoney, renderLayout } = require("./_shared");

// `payment` is a payments row (status should be 'captured' by the time
// this is called -- see notification.service.js).
function render({ order, payment }) {
  const subject = `Payment successful for your Aaranya order #${order.order_number}`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(order.customer_name)},</p>
    <p style="margin:0 0 16px 0;">We've received your payment. Your order is now being prepared.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px; color:#6b6657; margin: 16px 0;">
      <tr><td>Order number</td><td style="text-align:right; color:#2e3122;">${escapeHtml(order.order_number)}</td></tr>
      <tr><td>Payment ID</td><td style="text-align:right; color:#2e3122;">${escapeHtml(payment.razorpay_payment_id)}</td></tr>
      <tr><td>Amount paid</td><td style="text-align:right; color:#2e3122;">${formatMoney(payment.amount, order.currency)}</td></tr>
      <tr><td>Status</td><td style="text-align:right; color:#2e3122; text-transform:capitalize;">${escapeHtml(payment.status)}</td></tr>
    </table>
  `;

  const text = [
    `Hi ${order.customer_name},`,
    `Payment successful for your Aaranya order #${order.order_number}.`,
    `Payment ID: ${payment.razorpay_payment_id}`,
    `Amount paid: ${formatMoney(payment.amount, order.currency)}`,
    `Status: ${payment.status}`,
  ].join("\n");

  return { subject, html: renderLayout({ previewText: subject, bodyHtml }), text };
}

module.exports = { render };
