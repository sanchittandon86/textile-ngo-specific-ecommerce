// Dedicated WhatsApp service -- the only place the Meta WhatsApp Cloud
// API is called from. notification.service.js calls this; nothing else
// should. Uses the official Graph API directly (fetch), no unofficial
// automation library and no SDK dependency for a single REST call.
require("dotenv").config();

const DEFAULT_API_VERSION = "v21.0";

// All orders in this store currently ship within India (shipping_country
// defaults to "India", Razorpay/pricing assume INR) and customer_phone is
// stored as whatever digits the checkout form validated -- 10-15 digits,
// no structure (see checkout.service.js PHONE_PATTERN). There is no
// reliable signal for a non-Indian number today, so this deliberately
// only resolves the two unambiguous shapes below and refuses to guess
// for anything else, per the explicit "don't blindly prepend +91"
// requirement.
function normalizePhoneToE164(rawPhone, shippingCountry) {
  const trimmed = String(rawPhone || "").trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (hadPlus) {
    // Caller already supplied an explicit country code -- just sanity
    // check E.164 length bounds, don't reinterpret it.
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const isIndia = !shippingCountry || shippingCountry.trim().toLowerCase() === "india";
  if (!isIndia) return null;

  // A bare 10-digit Indian mobile number (the common case for this store).
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }

  // Already includes the "91" country code but no "+" (e.g. pasted as
  // "919876543210").
  if (digits.length === 12 && digits.startsWith("91") && /^91[6-9]\d{9}$/.test(digits)) {
    return `+${digits}`;
  }

  return null;
}

// WhatsApp Business messaging requires an approved template for the
// first message in a 24h window (which every transactional notification
// is, since customers don't have accounts/ongoing conversations) --
// free-form text is not permitted here. templateName and languageCode
// are provided by the caller (notification.service.js), which maps each
// notification_type to its configured WHATSAPP_TEMPLATE_* env var; this
// function only knows how to deliver a named template, not which one a
// given event should use.
//
// bodyParams is an ordered list of strings filling the template's {{1}},
// {{2}}, ... body placeholders, exactly as configured in the Meta
// Business Manager template definition.
//
// Always resolves (never rejects) with a predictable shape:
//   { ok: true, providerMessageId }
//   { ok: false, error }
async function sendWhatsAppTemplate({ to, templateName, languageCode = "en_US", bodyParams = [] }) {
  if (!to || typeof to !== "string" || !to.startsWith("+")) {
    return { ok: false, error: "Missing or invalid recipient phone number (expected E.164)" };
  }

  if (!templateName) {
    return { ok: false, error: "No WhatsApp template configured for this notification" };
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION;

  if (!accessToken || !phoneNumberId) {
    console.error("WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not configured");
    return { ok: false, error: "WhatsApp service is not configured" };
  }

  // Meta's "to" field is digits only, no leading "+".
  const toDigits = to.slice(1);

  const payload = {
    messaging_product: "whatsapp",
    to: toDigits,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(bodyParams.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: bodyParams.map((text) => ({ type: "text", text: String(text) })),
              },
            ],
          }
        : {}),
    },
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = body?.error?.message || `WhatsApp API error (HTTP ${response.status})`;
      console.error("WhatsApp send failed:", message);
      return { ok: false, error: message };
    }

    const providerMessageId = body?.messages?.[0]?.id || null;
    return { ok: true, providerMessageId };
  } catch (error) {
    console.error("WhatsApp send threw:", error.message);
    return { ok: false, error: error.message || "Unable to send WhatsApp message" };
  }
}

module.exports = { sendWhatsAppTemplate, normalizePhoneToE164 };
