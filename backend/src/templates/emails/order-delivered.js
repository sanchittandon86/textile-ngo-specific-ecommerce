const { escapeHtml, renderLayout } = require("./_shared");

function render({ order }) {
  const subject = `Your Aaranya order #${order.order_number} has been delivered`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${escapeHtml(order.customer_name)},</p>
    <p style="margin:0 0 16px 0;">Your order #${escapeHtml(order.order_number)} has been delivered. We hope you love it.</p>
    <p style="margin:0; color:#6b6657; font-size:13px;">Thank you for shopping with Aaranya.</p>
  `;

  const text = [
    `Hi ${order.customer_name},`,
    `Your Aaranya order #${order.order_number} has been delivered.`,
    "Thank you for shopping with Aaranya.",
  ].join("\n");

  return { subject, html: renderLayout({ previewText: subject, bodyHtml }), text };
}

module.exports = { render };
