// Shared helpers for every email template below -- escaping, money
// formatting, and the common earthy/warm Aaranya layout wrapper. Kept
// deliberately simple: plain inline-styled HTML tables, no build step,
// no external CSS (email clients strip <link>/most <style> support is
// unreliable), which is the standard approach for transactional email.

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value, currency = "INR") {
  const amount = Number(value);
  if (Number.isNaN(amount)) return escapeHtml(value);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

const COLORS = {
  bg: "#f5efe4",
  card: "#ffffff",
  ink: "#2e3122",
  inkMuted: "#6b6657",
  olive: "#4b5138",
  oliveDark: "#3b402c",
  beige: "#e4ded2",
};

// `bodyHtml` is pre-built HTML from the caller (already escaped where
// needed) -- this only wraps it in the shared header/footer chrome.
function renderLayout({ previewText, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Aaranya</title>
</head>
<body style="margin:0; padding:0; background-color:${COLORS.bg}; font-family: Georgia, 'Times New Roman', serif;">
  <span style="display:none; font-size:1px; color:${COLORS.bg}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
    ${escapeHtml(previewText || "")}
  </span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bg}; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:${COLORS.card}; border:1px solid ${COLORS.beige};">
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom:1px solid ${COLORS.beige};">
              <div style="font-size:22px; color:${COLORS.ink}; letter-spacing:0.02em;">Aaranya</div>
              <div style="font-size:11px; color:${COLORS.inkMuted}; letter-spacing:0.15em; text-transform:uppercase; margin-top:2px;">Textiles &amp; Living</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px; font-family: -apple-system, Helvetica, Arial, sans-serif; color:${COLORS.ink}; font-size:15px; line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px 28px 32px; border-top:1px solid ${COLORS.beige}; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size:12px; color:${COLORS.inkMuted};">
              Handcrafted with care. Made for everyday living.<br />
              Aaranya Textiles &amp; Living
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderItemsTable(items, currency) {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 0; border-bottom:1px solid ${COLORS.beige};">${escapeHtml(item.product_name)} &times; ${escapeHtml(item.quantity)}</td>
          <td style="padding:8px 0; border-bottom:1px solid ${COLORS.beige}; text-align:right; white-space:nowrap;">${formatMoney(item.line_total, currency)}</td>
        </tr>`
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px; margin: 16px 0;">${rows}</table>`;
}

function renderButton(href, label) {
  if (!href) return "";
  return `<a href="${escapeHtml(href)}" style="display:inline-block; margin-top:16px; padding:12px 24px; background-color:${COLORS.olive}; color:#ffffff; text-decoration:none; font-size:12px; letter-spacing:0.08em; text-transform:uppercase;">${escapeHtml(label)}</a>`;
}

module.exports = {
  escapeHtml,
  formatMoney,
  renderLayout,
  renderItemsTable,
  renderButton,
  COLORS,
};
