// Dedicated email service -- the only place the Resend SDK is called
// from. notification.service.js calls this; nothing else should.
const { getResend } = require("../config/resend");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === "string" && EMAIL_PATTERN.test(email.trim());
}

// Always resolves (never rejects) with a predictable shape:
//   { ok: true, providerMessageId }
//   { ok: false, error }
// so a provider outage or bad input can never become an unhandled
// rejection in a fire-and-forget notification call.
async function sendEmail({ to, subject, html, text }) {
  if (!isValidEmail(to)) {
    return { ok: false, error: "Missing or invalid recipient email address" };
  }

  if (!subject || !html) {
    return { ok: false, error: "Missing subject or html body" };
  }

  if (!process.env.EMAIL_FROM) {
    console.error("EMAIL_FROM is not configured");
    return { ok: false, error: "EMAIL_FROM is not configured" };
  }

  let resend;

  try {
    resend = getResend();
  } catch (error) {
    console.error("Email service unavailable:", error.message);
    return { ok: false, error: "Email service is not configured" };
  }

  try {
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
    });

    if (result.error) {
      console.error("Resend send failed:", result.error.message);
      return { ok: false, error: result.error.message || "Email provider error" };
    }

    return { ok: true, providerMessageId: result.data?.id || null };
  } catch (error) {
    console.error("Resend send threw:", error.message);
    return { ok: false, error: error.message || "Unable to send email" };
  }
}

module.exports = { sendEmail, isValidEmail };
