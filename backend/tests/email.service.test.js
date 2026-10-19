jest.mock("../src/config/resend", () => ({
  getResend: jest.fn(),
}));

const { getResend } = require("../src/config/resend");
const { sendEmail, isValidEmail } = require("../src/services/email.service");

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EMAIL_FROM = "Aaranya <orders@aaranya.example>";
});

describe("isValidEmail", () => {
  test("accepts a well-formed address", () => {
    expect(isValidEmail("customer@example.com")).toBe(true);
  });

  test("rejects missing/malformed addresses", () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("missing-domain@")).toBe(false);
  });
});

describe("sendEmail", () => {
  test("sends successfully and returns the provider message ID", async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: "resend_msg_1" }, error: null });
    getResend.mockReturnValue({ emails: { send } });

    const result = await sendEmail({
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
    });

    expect(result).toEqual({ ok: true, providerMessageId: "resend_msg_1" });
    expect(send).toHaveBeenCalledWith({
      from: "Aaranya <orders@aaranya.example>",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
    });
  });

  test("returns ok:false when Resend returns a provider error", async () => {
    const send = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "Invalid from address", statusCode: 422, name: "invalid_from_address" },
    });
    getResend.mockReturnValue({ emails: { send } });

    const result = await sendEmail({ to: "customer@example.com", subject: "Test", html: "<p>hi</p>" });

    expect(result).toEqual({ ok: false, error: "Invalid from address" });
  });

  test("returns ok:false (never throws) when the Resend call itself throws", async () => {
    const send = jest.fn().mockRejectedValue(new Error("network timeout"));
    getResend.mockReturnValue({ emails: { send } });

    const result = await sendEmail({ to: "customer@example.com", subject: "Test", html: "<p>hi</p>" });

    expect(result).toEqual({ ok: false, error: "network timeout" });
  });

  test("returns ok:false for a missing/invalid recipient, without calling Resend", async () => {
    const result = await sendEmail({ to: "not-an-email", subject: "Test", html: "<p>hi</p>" });

    expect(result.ok).toBe(false);
    expect(getResend).not.toHaveBeenCalled();
  });

  test("returns ok:false when EMAIL_FROM is not configured", async () => {
    delete process.env.EMAIL_FROM;

    const result = await sendEmail({ to: "customer@example.com", subject: "Test", html: "<p>hi</p>" });

    expect(result.ok).toBe(false);
    expect(getResend).not.toHaveBeenCalled();
  });

  test("returns ok:false (never throws) when the Resend client itself is unconfigured", async () => {
    getResend.mockImplementation(() => {
      throw new Error("RESEND_API_KEY must be set to send email");
    });

    const result = await sendEmail({ to: "customer@example.com", subject: "Test", html: "<p>hi</p>" });

    expect(result).toEqual({ ok: false, error: "Email service is not configured" });
  });
});
