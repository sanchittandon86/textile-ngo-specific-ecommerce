// Central notification orchestration layer. Business logic (checkout,
// payments, admin fulfillment) calls the sendXNotifications(orderId)
// functions below; this module is the only thing that talks to
// email.service.js and whatsapp.service.js, and the only thing that
// writes order_notifications rows.
//
// Architecture:
//   notification.service.js
//           |
//           +---- email.service.js    (Resend)
//           |
//           +---- whatsapp.service.js (Meta WhatsApp Cloud API)
//
// Every exported sendXNotifications function is designed to NEVER throw
// or reject -- callers invoke these fire-and-forget (after their own DB
// transaction has already committed; see checkout.service.js,
// payments.service.js, admin.service.js) and a notification failure must
// never surface as an application error or roll back anything.
const pool = require("../config/db");
const { sendEmail, isValidEmail } = require("./email.service");
const { sendWhatsAppTemplate, normalizePhoneToE164 } = require("./whatsapp.service");

const orderPlacedTemplate = require("../templates/emails/order-placed");
const paymentSuccessTemplate = require("../templates/emails/payment-success");
const orderShippedTemplate = require("../templates/emails/order-shipped");
const orderDeliveredTemplate = require("../templates/emails/order-delivered");
const refundInitiatedTemplate = require("../templates/emails/refund-initiated");
const refundCompletedTemplate = require("../templates/emails/refund-completed");

// Maps each notification_type to the env var holding its approved Meta
// template name. Never hard-code a template name/ID -- see .env.example
// for what must be created in Meta Business Manager for each of these.
const WHATSAPP_TEMPLATE_ENV_VAR = {
  ORDER_PLACED: "WHATSAPP_TEMPLATE_ORDER_PLACED",
  PAYMENT_SUCCESS: "WHATSAPP_TEMPLATE_PAYMENT_SUCCESS",
  ORDER_SHIPPED: "WHATSAPP_TEMPLATE_ORDER_SHIPPED",
  ORDER_DELIVERED: "WHATSAPP_TEMPLATE_ORDER_DELIVERED",
  REFUND_INITIATED: "WHATSAPP_TEMPLATE_REFUND_INITIATED",
  REFUND_COMPLETED: "WHATSAPP_TEMPLATE_REFUND_COMPLETED",
};

function whatsappTemplateName(notificationType) {
  const envVar = WHATSAPP_TEMPLATE_ENV_VAR[notificationType];
  return envVar ? process.env[envVar] || null : null;
}

async function loadOrder(orderId) {
  const result = await pool.query(
    `SELECT id, order_number, status, payment_status, payment_method,
            customer_name, customer_email, customer_phone,
            shipping_address_line1, shipping_address_line2, shipping_city,
            shipping_state, shipping_postal_code, shipping_country,
            subtotal, shipping_fee, discount_amount, total_amount, currency,
            tracking_carrier, tracking_number, created_at
     FROM orders
     WHERE id = $1`,
    [orderId]
  );
  return result.rows[0] || null;
}

async function loadOrderItems(orderId) {
  const result = await pool.query(
    `SELECT product_name, quantity, unit_price, line_total
     FROM order_items
     WHERE order_id = $1
     ORDER BY id ASC`,
    [orderId]
  );
  return result.rows;
}

async function loadLatestCapturedPayment(orderId) {
  const result = await pool.query(
    `SELECT razorpay_payment_id, amount, status
     FROM payments
     WHERE order_id = $1 AND status = 'captured'
     ORDER BY verified_at DESC
     LIMIT 1`,
    [orderId]
  );
  return result.rows[0] || null;
}

// Updates one order_notifications row. Only ever touches a row this
// process itself just created or is retrying -- never used to create one
// (see recordAndSend/retryNotification for the INSERT side).
async function updateNotificationStatus(id, { status, providerMessageId, errorMessage, sentAt }) {
  await pool.query(
    `UPDATE order_notifications
     SET status = $1,
         provider_message_id = COALESCE($2, provider_message_id),
         error_message = $3,
         sent_at = CASE WHEN $4 THEN NOW() ELSE sent_at END,
         updated_at = NOW()
     WHERE id = $5`,
    [status, providerMessageId || null, errorMessage || null, Boolean(sentAt), id]
  );
}

function logEvent(level, message, meta) {
  // Structured, single-line logging -- never includes provider
  // credentials or full recipient PII beyond what's needed to debug
  // (order id + notification type + channel are enough to look up the
  // rest in order_notifications if truly needed).
  const line = { msg: message, ...meta };
  (level === "error" ? console.error : console.log)("[notifications]", JSON.stringify(line));
}

// The idempotency + delivery core shared by every event below.
//   - `recipient` may be null (no usable contact info) -- a FAILED row
//     is still recorded with a clear reason, and this never throws.
//   - `send` is a zero-arg async closure that performs the actual
//     provider call and resolves to { ok, providerMessageId } or
//     { ok: false, error }.
// The INSERT ... ON CONFLICT DO NOTHING is the real idempotency
// guarantee (database-constraint-backed, not an in-memory flag): if a
// row for this order/type/channel already exists, no second attempt is
// made, no matter how many times the caller re-triggers the same event.
async function recordAndSend({ orderId, notificationType, channel, recipient, send }) {
  logEvent("info", "notification requested", { orderId, notificationType, channel });

  let row;
  try {
    const insertResult = await pool.query(
      `INSERT INTO order_notifications (order_id, notification_type, channel, recipient, status)
       VALUES ($1, $2, $3, $4, 'PENDING')
       ON CONFLICT (order_id, notification_type, channel) DO NOTHING
       RETURNING id`,
      [orderId, notificationType, channel, recipient]
    );
    row = insertResult.rows[0];
  } catch (error) {
    logEvent("error", "failed to create notification record", {
      orderId,
      notificationType,
      channel,
      error: error.message,
    });
    return { outcome: "error" };
  }

  if (!row) {
    logEvent("info", "notification already recorded, skipping (idempotent)", {
      orderId,
      notificationType,
      channel,
    });
    return { outcome: "skipped_duplicate" };
  }

  const notificationId = row.id;

  if (!recipient) {
    const errorMessage =
      channel === "EMAIL"
        ? "No valid email address on file for this order"
        : "No valid phone number on file for this order";

    await updateNotificationStatus(notificationId, { status: "FAILED", errorMessage });
    logEvent("error", "notification failed: missing recipient", {
      orderId,
      notificationType,
      channel,
    });
    return { outcome: "failed", error: errorMessage };
  }

  let result;
  try {
    result = await send();
  } catch (error) {
    // email.service.js / whatsapp.service.js are designed to never
    // throw, but this is a deliberate last line of defense: a bug in
    // template rendering or elsewhere here must never propagate to the
    // caller or affect the other channel.
    result = { ok: false, error: error.message || "Unexpected notification error" };
  }

  if (result.ok) {
    await updateNotificationStatus(notificationId, {
      status: "SENT",
      providerMessageId: result.providerMessageId,
      sentAt: true,
    });
    logEvent("info", "notification sent", {
      orderId,
      notificationType,
      channel,
      providerMessageId: result.providerMessageId,
    });
    return { outcome: "sent", providerMessageId: result.providerMessageId };
  }

  await updateNotificationStatus(notificationId, { status: "FAILED", errorMessage: result.error });
  logEvent("error", "notification failed", {
    orderId,
    notificationType,
    channel,
    error: result.error,
  });
  return { outcome: "failed", error: result.error };
}

// Fires EMAIL and WHATSAPP independently -- one channel's outcome never
// affects the other (Promise.allSettled, not Promise.all).
async function sendBothChannels({ orderId, notificationType, emailAttempt, whatsappAttempt }) {
  const [emailResult, whatsappResult] = await Promise.allSettled([
    recordAndSend({ orderId, notificationType, channel: "EMAIL", ...emailAttempt }),
    recordAndSend({ orderId, notificationType, channel: "WHATSAPP", ...whatsappAttempt }),
  ]);

  return {
    email: emailResult.status === "fulfilled" ? emailResult.value : { outcome: "error" },
    whatsapp: whatsappResult.status === "fulfilled" ? whatsappResult.value : { outcome: "error" },
  };
}

function resolveEmailRecipient(order) {
  return isValidEmail(order.customer_email) ? order.customer_email.trim() : null;
}

function resolveWhatsAppRecipient(order) {
  return normalizePhoneToE164(order.customer_phone, order.shipping_country);
}

async function sendOrderPlacedNotifications(orderId) {
  try {
    const order = await loadOrder(orderId);
    if (!order) {
      logEvent("error", "order not found for ORDER_PLACED notification", { orderId });
      return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
    }

    const items = await loadOrderItems(orderId);
    const emailRecipient = resolveEmailRecipient(order);
    const whatsappRecipient = resolveWhatsAppRecipient(order);

    return await sendBothChannels({
      orderId,
      notificationType: "ORDER_PLACED",
      emailAttempt: {
        recipient: emailRecipient,
        send: async () => {
          const { subject, html, text } = orderPlacedTemplate.render({ order, items });
          return sendEmail({ to: emailRecipient, subject, html, text });
        },
      },
      whatsappAttempt: {
        recipient: whatsappRecipient,
        send: () =>
          sendWhatsAppTemplate({
            to: whatsappRecipient,
            templateName: whatsappTemplateName("ORDER_PLACED"),
            bodyParams: [order.order_number, String(order.total_amount)],
          }),
      },
    });
  } catch (error) {
    logEvent("error", "sendOrderPlacedNotifications crashed", { orderId, error: error.message });
    return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
  }
}

// Call only after a payment has actually just been captured (i.e. the
// caller's capturePayment() returned alreadyProcessed: false) -- see
// payments.service.js. That, plus the order_notifications idempotency
// constraint below, is the two-layer duplicate-webhook protection the
// spec requires: capturePayment's own FOR UPDATE + status check means
// this function is only even invoked once per real capture, and the
// DB constraint here is the backstop if it were ever invoked twice.
async function sendPaymentSuccessNotifications(orderId) {
  try {
    const order = await loadOrder(orderId);
    if (!order) {
      logEvent("error", "order not found for PAYMENT_SUCCESS notification", { orderId });
      return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
    }

    const payment = await loadLatestCapturedPayment(orderId);
    if (!payment) {
      logEvent("error", "no captured payment found for PAYMENT_SUCCESS notification", { orderId });
      return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
    }

    const emailRecipient = resolveEmailRecipient(order);
    const whatsappRecipient = resolveWhatsAppRecipient(order);

    return await sendBothChannels({
      orderId,
      notificationType: "PAYMENT_SUCCESS",
      emailAttempt: {
        recipient: emailRecipient,
        send: async () => {
          const { subject, html, text } = paymentSuccessTemplate.render({ order, payment });
          return sendEmail({ to: emailRecipient, subject, html, text });
        },
      },
      whatsappAttempt: {
        recipient: whatsappRecipient,
        send: () =>
          sendWhatsAppTemplate({
            to: whatsappRecipient,
            templateName: whatsappTemplateName("PAYMENT_SUCCESS"),
            bodyParams: [order.order_number, String(payment.amount)],
          }),
      },
    });
  } catch (error) {
    logEvent("error", "sendPaymentSuccessNotifications crashed", { orderId, error: error.message });
    return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
  }
}

// Call only after a genuine processing -> shipped transition (see
// updateOrderFulfillment in admin.service.js, which already rejects a
// repeat "mark as shipped" with a 409 before this would ever be called
// again) -- the order_notifications constraint is the backstop.
async function sendOrderShippedNotifications(orderId) {
  try {
    const order = await loadOrder(orderId);
    if (!order) {
      logEvent("error", "order not found for ORDER_SHIPPED notification", { orderId });
      return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
    }

    const emailRecipient = resolveEmailRecipient(order);
    const whatsappRecipient = resolveWhatsAppRecipient(order);

    return await sendBothChannels({
      orderId,
      notificationType: "ORDER_SHIPPED",
      emailAttempt: {
        recipient: emailRecipient,
        send: async () => {
          const { subject, html, text } = orderShippedTemplate.render({ order });
          return sendEmail({ to: emailRecipient, subject, html, text });
        },
      },
      whatsappAttempt: {
        recipient: whatsappRecipient,
        send: () =>
          sendWhatsAppTemplate({
            to: whatsappRecipient,
            templateName: whatsappTemplateName("ORDER_SHIPPED"),
            bodyParams: [
              order.order_number,
              order.tracking_carrier || "N/A",
              order.tracking_number || "N/A",
            ],
          }),
      },
    });
  } catch (error) {
    logEvent("error", "sendOrderShippedNotifications crashed", { orderId, error: error.message });
    return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
  }
}

// Call only after a genuine ... -> delivered transition (same reasoning
// as sendOrderShippedNotifications above).
async function sendOrderDeliveredNotifications(orderId) {
  try {
    const order = await loadOrder(orderId);
    if (!order) {
      logEvent("error", "order not found for ORDER_DELIVERED notification", { orderId });
      return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
    }

    const emailRecipient = resolveEmailRecipient(order);
    const whatsappRecipient = resolveWhatsAppRecipient(order);

    return await sendBothChannels({
      orderId,
      notificationType: "ORDER_DELIVERED",
      emailAttempt: {
        recipient: emailRecipient,
        send: async () => {
          const { subject, html, text } = orderDeliveredTemplate.render({ order });
          return sendEmail({ to: emailRecipient, subject, html, text });
        },
      },
      whatsappAttempt: {
        recipient: whatsappRecipient,
        send: () =>
          sendWhatsAppTemplate({
            to: whatsappRecipient,
            templateName: whatsappTemplateName("ORDER_DELIVERED"),
            bodyParams: [order.order_number],
          }),
      },
    });
  } catch (error) {
    logEvent("error", "sendOrderDeliveredNotifications crashed", { orderId, error: error.message });
    return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
  }
}

// NOT currently called from anywhere -- there is no refund workflow in
// this codebase (no Razorpay refund API integration, no admin refund
// endpoint; "refunded" is only an unused payment_status enum value).
// Implemented and tested so a future refund feature has a ready
// notification path: call this only after a refund has actually been
// successfully initiated with Razorpay, never merely because an admin
// changed a database field. `refund` = { amount, refundId }.
async function sendRefundInitiatedNotifications(orderId, refund) {
  try {
    const order = await loadOrder(orderId);
    if (!order) {
      logEvent("error", "order not found for REFUND_INITIATED notification", { orderId });
      return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
    }

    const emailRecipient = resolveEmailRecipient(order);
    const whatsappRecipient = resolveWhatsAppRecipient(order);

    return await sendBothChannels({
      orderId,
      notificationType: "REFUND_INITIATED",
      emailAttempt: {
        recipient: emailRecipient,
        send: async () => {
          const { subject, html, text } = refundInitiatedTemplate.render({ order, refund });
          return sendEmail({ to: emailRecipient, subject, html, text });
        },
      },
      whatsappAttempt: {
        recipient: whatsappRecipient,
        send: () =>
          sendWhatsAppTemplate({
            to: whatsappRecipient,
            templateName: whatsappTemplateName("REFUND_INITIATED"),
            bodyParams: [order.order_number, String(refund.amount)],
          }),
      },
    });
  } catch (error) {
    logEvent("error", "sendRefundInitiatedNotifications crashed", { orderId, error: error.message });
    return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
  }
}

// NOT currently called from anywhere -- see sendRefundInitiatedNotifications
// above. Call only after Razorpay actually confirms the refund succeeded.
// `refund` = { amount, paymentId, status }.
async function sendRefundCompletedNotifications(orderId, refund) {
  try {
    const order = await loadOrder(orderId);
    if (!order) {
      logEvent("error", "order not found for REFUND_COMPLETED notification", { orderId });
      return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
    }

    const emailRecipient = resolveEmailRecipient(order);
    const whatsappRecipient = resolveWhatsAppRecipient(order);

    return await sendBothChannels({
      orderId,
      notificationType: "REFUND_COMPLETED",
      emailAttempt: {
        recipient: emailRecipient,
        send: async () => {
          const { subject, html, text } = refundCompletedTemplate.render({ order, refund });
          return sendEmail({ to: emailRecipient, subject, html, text });
        },
      },
      whatsappAttempt: {
        recipient: whatsappRecipient,
        send: () =>
          sendWhatsAppTemplate({
            to: whatsappRecipient,
            templateName: whatsappTemplateName("REFUND_COMPLETED"),
            bodyParams: [order.order_number, String(refund.amount)],
          }),
      },
    });
  } catch (error) {
    logEvent("error", "sendRefundCompletedNotifications crashed", { orderId, error: error.message });
    return { email: { outcome: "error" }, whatsapp: { outcome: "error" } };
  }
}

// Re-attempts exactly one existing FAILED notification row in place
// (never inserts a new row -- the unique constraint wouldn't allow a
// second row for the same order/type/channel anyway). Not currently
// exposed through any route (no existing admin retry-notification
// pattern to follow); callable directly for now, e.g. from a future
// admin endpoint or an ops script.
async function retryNotification(notificationId) {
  const rowResult = await pool.query(
    `SELECT on2.id, on2.order_id, on2.notification_type, on2.channel, on2.recipient, on2.status
     FROM order_notifications on2
     WHERE on2.id = $1`,
    [notificationId]
  );
  const notification = rowResult.rows[0];

  if (!notification) {
    return { ok: false, error: "Notification not found" };
  }

  if (notification.status === "SENT") {
    return { ok: false, error: "Notification was already sent" };
  }

  const order = await loadOrder(notification.order_id);
  if (!order) {
    return { ok: false, error: "Order not found" };
  }

  if (!notification.recipient) {
    return { ok: false, error: "No recipient on file -- cannot retry" };
  }

  let send;

  if (notification.notification_type === "ORDER_PLACED") {
    const items = await loadOrderItems(order.id);
    send =
      notification.channel === "EMAIL"
        ? async () => {
            const { subject, html, text } = orderPlacedTemplate.render({ order, items });
            return sendEmail({ to: notification.recipient, subject, html, text });
          }
        : () =>
            sendWhatsAppTemplate({
              to: notification.recipient,
              templateName: whatsappTemplateName("ORDER_PLACED"),
              bodyParams: [order.order_number, String(order.total_amount)],
            });
  } else if (notification.notification_type === "PAYMENT_SUCCESS") {
    const payment = await loadLatestCapturedPayment(order.id);
    if (!payment) return { ok: false, error: "No captured payment found" };
    send =
      notification.channel === "EMAIL"
        ? async () => {
            const { subject, html, text } = paymentSuccessTemplate.render({ order, payment });
            return sendEmail({ to: notification.recipient, subject, html, text });
          }
        : () =>
            sendWhatsAppTemplate({
              to: notification.recipient,
              templateName: whatsappTemplateName("PAYMENT_SUCCESS"),
              bodyParams: [order.order_number, String(payment.amount)],
            });
  } else if (notification.notification_type === "ORDER_SHIPPED") {
    send =
      notification.channel === "EMAIL"
        ? async () => {
            const { subject, html, text } = orderShippedTemplate.render({ order });
            return sendEmail({ to: notification.recipient, subject, html, text });
          }
        : () =>
            sendWhatsAppTemplate({
              to: notification.recipient,
              templateName: whatsappTemplateName("ORDER_SHIPPED"),
              bodyParams: [order.order_number, order.tracking_carrier || "N/A", order.tracking_number || "N/A"],
            });
  } else if (notification.notification_type === "ORDER_DELIVERED") {
    send =
      notification.channel === "EMAIL"
        ? async () => {
            const { subject, html, text } = orderDeliveredTemplate.render({ order });
            return sendEmail({ to: notification.recipient, subject, html, text });
          }
        : () =>
            sendWhatsAppTemplate({
              to: notification.recipient,
              templateName: whatsappTemplateName("ORDER_DELIVERED"),
              bodyParams: [order.order_number],
            });
  } else {
    return { ok: false, error: `Retry not implemented for ${notification.notification_type}` };
  }

  let result;
  try {
    result = await send();
  } catch (error) {
    result = { ok: false, error: error.message || "Unexpected notification error" };
  }

  if (result.ok) {
    await updateNotificationStatus(notification.id, {
      status: "SENT",
      providerMessageId: result.providerMessageId,
      sentAt: true,
    });
  } else {
    await updateNotificationStatus(notification.id, { status: "FAILED", errorMessage: result.error });
  }

  return result;
}

module.exports = {
  sendOrderPlacedNotifications,
  sendPaymentSuccessNotifications,
  sendOrderShippedNotifications,
  sendOrderDeliveredNotifications,
  sendRefundInitiatedNotifications,
  sendRefundCompletedNotifications,
  retryNotification,
};
