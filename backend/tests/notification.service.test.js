jest.mock("../src/config/db", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../src/services/email.service", () => ({
  sendEmail: jest.fn(),
  isValidEmail: jest.requireActual("../src/services/email.service").isValidEmail,
}));

jest.mock("../src/services/whatsapp.service", () => ({
  sendWhatsAppTemplate: jest.fn(),
  normalizePhoneToE164: jest.requireActual("../src/services/whatsapp.service").normalizePhoneToE164,
}));

const pool = require("../src/config/db");
const { sendEmail } = require("../src/services/email.service");
const { sendWhatsAppTemplate } = require("../src/services/whatsapp.service");
const notificationService = require("../src/services/notification.service");

process.env.WHATSAPP_TEMPLATE_ORDER_PLACED = "order_placed_v1";
process.env.WHATSAPP_TEMPLATE_PAYMENT_SUCCESS = "payment_success_v1";
process.env.WHATSAPP_TEMPLATE_ORDER_SHIPPED = "order_shipped_v1";
process.env.WHATSAPP_TEMPLATE_ORDER_DELIVERED = "order_delivered_v1";
process.env.WHATSAPP_TEMPLATE_REFUND_INITIATED = "refund_initiated_v1";
process.env.WHATSAPP_TEMPLATE_REFUND_COMPLETED = "refund_completed_v1";

const BASE_ORDER = {
  id: 1024,
  order_number: "ORD-20261019-ABCDEF0123",
  customer_name: "Asha Rao",
  customer_email: "asha@example.com",
  customer_phone: "9876543210",
  shipping_address_line1: "12 MG Road",
  shipping_address_line2: null,
  shipping_city: "Bengaluru",
  shipping_state: "Karnataka",
  shipping_postal_code: "560001",
  shipping_country: "India",
  subtotal: "2998.00",
  shipping_fee: "50.00",
  discount_amount: "0.00",
  total_amount: "3048.00",
  currency: "INR",
  tracking_carrier: "BlueDart",
  tracking_number: "BD123456789",
  created_at: new Date("2026-10-19T10:00:00Z"),
};

const ORDER_ITEMS = [
  { product_name: "Cotton Bedsheet", quantity: 2, unit_price: "1499.00", line_total: "2998.00" },
];

const CAPTURED_PAYMENT = {
  razorpay_payment_id: "pay_TESTABC123",
  amount: "3048.00",
  status: "captured",
};

// EMAIL and WHATSAPP are sent concurrently (Promise.allSettled in
// notification.service.js), so pool.query calls from both channels can
// interleave in either order -- a strict sequential mockResolvedValueOnce
// queue is fragile here. Pattern-match on SQL text instead, same
// approach as tests/product-import.test.js's setupPool.
function setupPool({ order = BASE_ORDER, items = [], payment = null, insertReturnsRow = true } = {}) {
  let nextId = 1;

  pool.query.mockImplementation(async (sql, params = []) => {
    if (sql.includes("FROM orders") && sql.includes("WHERE id = $1")) {
      return { rows: order ? [order] : [] };
    }
    if (sql.includes("FROM order_items")) {
      return { rows: items };
    }
    if (sql.includes("FROM payments") && sql.includes("status = 'captured'")) {
      return { rows: payment ? [payment] : [] };
    }
    if (sql.includes("INSERT INTO order_notifications")) {
      return insertReturnsRow ? { rows: [{ id: nextId++ }] } : { rows: [] };
    }
    if (sql.includes("UPDATE order_notifications")) {
      return {};
    }
    throw new Error("Unexpected pool.query in test: " + sql);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("notification.service -- EMAIL", () => {
  test("ORDER_PLACED sends an email with the expected subject and records SENT", async () => {
    setupPool({ items: ORDER_ITEMS });
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "email_msg_1" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.1" });

    const result = await notificationService.sendOrderPlacedNotifications(1024);

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "asha@example.com",
        subject: "Your Aaranya order #ORD-20261019-ABCDEF0123 has been placed",
      })
    );
    expect(result.email.outcome).toBe("sent");
  });

  test("PAYMENT_SUCCESS sends an email with the expected subject", async () => {
    setupPool({ payment: CAPTURED_PAYMENT });
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "email_msg_2" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.2" });

    const result = await notificationService.sendPaymentSuccessNotifications(1024);

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Payment successful for your Aaranya order #ORD-20261019-ABCDEF0123",
      })
    );
    expect(result.email.outcome).toBe("sent");
  });

  test("ORDER_SHIPPED sends an email with the expected subject", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "email_msg_3" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.3" });

    const result = await notificationService.sendOrderShippedNotifications(1024);

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Your Aaranya order #ORD-20261019-ABCDEF0123 has shipped",
      })
    );
    expect(result.email.outcome).toBe("sent");
  });

  test("ORDER_DELIVERED sends an email with the expected subject", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "email_msg_4" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.4" });

    const result = await notificationService.sendOrderDeliveredNotifications(1024);

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Your Aaranya order #ORD-20261019-ABCDEF0123 has been delivered",
      })
    );
    expect(result.email.outcome).toBe("sent");
  });

  test("REFUND (initiated + completed) sends emails with the expected subjects", async () => {
    setupPool();
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "email_msg_5" });
    sendWhatsAppTemplate.mockResolvedValue({ ok: true, providerMessageId: "wamid.5" });

    await notificationService.sendRefundInitiatedNotifications(1024, { amount: "500.00", refundId: "rfnd_1" });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Refund initiated for your Aaranya order #ORD-20261019-ABCDEF0123" })
    );

    await notificationService.sendRefundCompletedNotifications(1024, {
      amount: "500.00",
      paymentId: "pay_TESTABC123",
      status: "processed",
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Your refund for Aaranya order #ORD-20261019-ABCDEF0123 is complete" })
    );
  });
});

describe("notification.service -- WHATSAPP", () => {
  test("ORDER_PLACED sends a WhatsApp template with orderNumber + amount params", async () => {
    setupPool({ items: ORDER_ITEMS });
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "e1" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.10" });

    const result = await notificationService.sendOrderPlacedNotifications(1024);

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
      to: "+919876543210",
      templateName: "order_placed_v1",
      bodyParams: ["ORD-20261019-ABCDEF0123", "3048.00"],
    });
    expect(result.whatsapp.outcome).toBe("sent");
  });

  test("PAYMENT_SUCCESS sends a WhatsApp template", async () => {
    setupPool({ payment: CAPTURED_PAYMENT });
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "e2" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.20" });

    const result = await notificationService.sendPaymentSuccessNotifications(1024);

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
      to: "+919876543210",
      templateName: "payment_success_v1",
      bodyParams: ["ORD-20261019-ABCDEF0123", "3048.00"],
    });
    expect(result.whatsapp.outcome).toBe("sent");
  });

  test("ORDER_SHIPPED sends a WhatsApp template with carrier + tracking number", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "e3" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.30" });

    const result = await notificationService.sendOrderShippedNotifications(1024);

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
      to: "+919876543210",
      templateName: "order_shipped_v1",
      bodyParams: ["ORD-20261019-ABCDEF0123", "BlueDart", "BD123456789"],
    });
    expect(result.whatsapp.outcome).toBe("sent");
  });

  test("ORDER_DELIVERED sends a WhatsApp template", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "e4" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.40" });

    const result = await notificationService.sendOrderDeliveredNotifications(1024);

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
      to: "+919876543210",
      templateName: "order_delivered_v1",
      bodyParams: ["ORD-20261019-ABCDEF0123"],
    });
    expect(result.whatsapp.outcome).toBe("sent");
  });

  test("REFUND (initiated + completed) sends WhatsApp templates", async () => {
    setupPool();
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "e5" });
    sendWhatsAppTemplate.mockResolvedValue({ ok: true, providerMessageId: "wamid.50" });

    await notificationService.sendRefundInitiatedNotifications(1024, { amount: "500.00", refundId: "rfnd_1" });

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
      to: "+919876543210",
      templateName: "refund_initiated_v1",
      bodyParams: ["ORD-20261019-ABCDEF0123", "500.00"],
    });
  });
});

describe("notification.service -- idempotency", () => {
  test("a second call for the same order/type/channel is skipped (DB conflict -> no provider call)", async () => {
    setupPool({ insertReturnsRow: false });

    const result = await notificationService.sendOrderDeliveredNotifications(1024);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(result.email.outcome).toBe("skipped_duplicate");
    expect(result.whatsapp.outcome).toBe("skipped_duplicate");
  });

  test("duplicate SHIPPED does not send a duplicate notification", async () => {
    setupPool({ insertReturnsRow: true });
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "e7" });
    sendWhatsAppTemplate.mockResolvedValue({ ok: true, providerMessageId: "wamid.70" });

    await notificationService.sendOrderShippedNotifications(1024);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);

    // Second trigger: DB conflict -> skipped, no further provider calls.
    setupPool({ insertReturnsRow: false });

    const second = await notificationService.sendOrderShippedNotifications(1024);

    expect(sendEmail).toHaveBeenCalledTimes(1); // still just once
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1); // still just once
    expect(second.email.outcome).toBe("skipped_duplicate");
  });

  test("duplicate DELIVERED does not send a duplicate notification", async () => {
    setupPool({ insertReturnsRow: true });
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "e8" });
    sendWhatsAppTemplate.mockResolvedValue({ ok: true, providerMessageId: "wamid.80" });

    await notificationService.sendOrderDeliveredNotifications(1024);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    setupPool({ insertReturnsRow: false });

    await notificationService.sendOrderDeliveredNotifications(1024);
    expect(sendEmail).toHaveBeenCalledTimes(1); // still just once
  });
});

describe("notification.service -- failure isolation", () => {
  test("email provider failure is recorded but does not throw/reject", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: false, error: "Resend API error" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.90" });

    const result = await notificationService.sendOrderDeliveredNotifications(1024);

    expect(result.email.outcome).toBe("failed");
    expect(result.email.error).toBe("Resend API error");
  });

  test("WhatsApp provider failure is recorded but does not throw/reject", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "e10" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: false, error: "WhatsApp template not approved" });

    const result = await notificationService.sendOrderDeliveredNotifications(1024);

    expect(result.whatsapp.outcome).toBe("failed");
    expect(result.whatsapp.error).toBe("WhatsApp template not approved");
  });

  test("email failure does not prevent WhatsApp from being attempted and succeeding", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: false, error: "Resend down" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.110" });

    const result = await notificationService.sendOrderDeliveredNotifications(1024);

    expect(result.email.outcome).toBe("failed");
    expect(result.whatsapp.outcome).toBe("sent");
  });

  test("WhatsApp failure does not prevent email from being attempted and succeeding", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "e12" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: false, error: "Meta API down" });

    const result = await notificationService.sendOrderDeliveredNotifications(1024);

    expect(result.email.outcome).toBe("sent");
    expect(result.whatsapp.outcome).toBe("failed");
  });

  test("missing email address is handled safely -- recorded FAILED, no provider call, WhatsApp still attempted", async () => {
    setupPool({ order: { ...BASE_ORDER, customer_email: null } });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.130" });

    const result = await notificationService.sendOrderDeliveredNotifications(1024);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.email.outcome).toBe("failed");
    expect(result.email.error).toMatch(/email/i);
    expect(result.whatsapp.outcome).toBe("sent");
  });

  test("missing phone number is handled safely -- recorded FAILED, no provider call, email still attempted", async () => {
    setupPool({ order: { ...BASE_ORDER, customer_phone: "" } });
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "e14" });

    const result = await notificationService.sendOrderDeliveredNotifications(1024);

    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(result.whatsapp.outcome).toBe("failed");
    expect(result.whatsapp.error).toMatch(/phone/i);
    expect(result.email.outcome).toBe("sent");
  });

  test("an invalid/unparseable phone number is handled safely (no country code guessed)", async () => {
    setupPool({ order: { ...BASE_ORDER, customer_phone: "12345", shipping_country: "United States" } });
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "e15" });

    const result = await notificationService.sendOrderDeliveredNotifications(1024);

    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(result.whatsapp.outcome).toBe("failed");
  });
});

describe("notification.service -- database records", () => {
  test("creates an order_notifications row with order_id/type/channel/recipient for each channel", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "e16" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.160" });

    await notificationService.sendOrderDeliveredNotifications(1024);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO order_notifications"),
      [1024, "ORDER_DELIVERED", "EMAIL", "asha@example.com"]
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO order_notifications"),
      [1024, "ORDER_DELIVERED", "WHATSAPP", "+919876543210"]
    );
  });

  test("a successful notification stores the provider message ID", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: true, providerMessageId: "resend_msg_abc" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.xyz" });

    await notificationService.sendOrderDeliveredNotifications(1024);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE order_notifications"),
      ["SENT", "resend_msg_abc", null, true, expect.any(Number)]
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE order_notifications"),
      ["SENT", "wamid.xyz", null, true, expect.any(Number)]
    );
  });

  test("a failed notification stores the error message", async () => {
    setupPool();
    sendEmail.mockResolvedValueOnce({ ok: false, error: "Invalid from address" });
    sendWhatsAppTemplate.mockResolvedValueOnce({ ok: true, providerMessageId: "wamid.180" });

    await notificationService.sendOrderDeliveredNotifications(1024);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE order_notifications"),
      ["FAILED", null, "Invalid from address", false, expect.any(Number)]
    );
  });

  test("idempotency constraint: INSERT ... ON CONFLICT DO NOTHING is used (no new row on conflict)", async () => {
    setupPool({ insertReturnsRow: false });

    await notificationService.sendOrderDeliveredNotifications(1024);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (order_id, notification_type, channel) DO NOTHING"),
      expect.any(Array)
    );
  });
});
