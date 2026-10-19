const { sendWhatsAppTemplate, normalizePhoneToE164 } = require("../src/services/whatsapp.service");

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
  process.env.WHATSAPP_API_VERSION = "v21.0";
  global.fetch = jest.fn();
});

describe("normalizePhoneToE164", () => {
  test("formats a bare 10-digit Indian mobile number", () => {
    expect(normalizePhoneToE164("9876543210", "India")).toBe("+919876543210");
  });

  test("accepts a number already including the 91 country code (no +)", () => {
    expect(normalizePhoneToE164("919876543210", "India")).toBe("+919876543210");
  });

  test("trusts an explicit + prefix as-is", () => {
    expect(normalizePhoneToE164("+44 7700 900123", "United Kingdom")).toBe("+447700900123");
  });

  test("does not guess a country code for a non-India order with no +", () => {
    expect(normalizePhoneToE164("4155552671", "United States")).toBeNull();
  });

  test("rejects an invalid/unparseable number", () => {
    expect(normalizePhoneToE164("12345", "India")).toBeNull();
    expect(normalizePhoneToE164("", "India")).toBeNull();
    expect(normalizePhoneToE164(null, "India")).toBeNull();
  });

  test("defaults to India when shippingCountry is missing", () => {
    expect(normalizePhoneToE164("9876543210", undefined)).toBe("+919876543210");
  });
});

describe("sendWhatsAppTemplate", () => {
  test("sends successfully and returns the provider message ID", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.ABC123" }] }),
    });

    const result = await sendWhatsAppTemplate({
      to: "+919876543210",
      templateName: "order_placed_v1",
      bodyParams: ["ORD-123", "999.00"],
    });

    expect(result).toEqual({ ok: true, providerMessageId: "wamid.ABC123" });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/123456789/messages");
    expect(options.headers.Authorization).toBe("Bearer test_access_token");

    const body = JSON.parse(options.body);
    expect(body.to).toBe("919876543210"); // no leading "+" per Meta's API contract
    expect(body.template.name).toBe("order_placed_v1");
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "ORD-123" },
      { type: "text", text: "999.00" },
    ]);
  });

  test("never sends the access token anywhere but the Authorization header", async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.1" }] }) });

    await sendWhatsAppTemplate({ to: "+919876543210", templateName: "order_placed_v1", bodyParams: [] });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.body).not.toContain("test_access_token");
  });

  test("returns ok:false on a Meta API error response", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Template not found", code: 132001 } }),
    });

    const result = await sendWhatsAppTemplate({ to: "+919876543210", templateName: "missing_template" });

    expect(result).toEqual({ ok: false, error: "Template not found" });
  });

  test("returns ok:false (never throws) when fetch itself throws", async () => {
    global.fetch.mockRejectedValue(new Error("network unreachable"));

    const result = await sendWhatsAppTemplate({ to: "+919876543210", templateName: "order_placed_v1" });

    expect(result).toEqual({ ok: false, error: "network unreachable" });
  });

  test("returns ok:false for a missing/non-E.164 recipient, without calling fetch", async () => {
    const result = await sendWhatsAppTemplate({ to: "9876543210", templateName: "order_placed_v1" });

    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns ok:false when no template name is configured", async () => {
    const result = await sendWhatsAppTemplate({ to: "+919876543210", templateName: null });

    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns ok:false when WhatsApp credentials are not configured", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;

    const result = await sendWhatsAppTemplate({ to: "+919876543210", templateName: "order_placed_v1" });

    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
