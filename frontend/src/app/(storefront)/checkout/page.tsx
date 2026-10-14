"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCart } from "@/lib/cart/CartProvider";
import { createOrder } from "@/lib/api/checkout";
import { createPaymentOrder, verifyPayment } from "@/lib/api/payments";
import { ApiError } from "@/lib/api/client";
import { loadRazorpayScript, type RazorpaySuccessResponse } from "@/lib/razorpay";
import { saveOrderToken } from "@/lib/orderToken";
import { formatMoney } from "@/lib/format";
import { Container } from "@/components/ui/Container";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { CartSummary } from "@/components/cart/CartSummary";
import type { CheckoutResult } from "@/lib/api/types";

const PHONE_PATTERN = /^[0-9]{10,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
  name: string;
  phone: string;
  email: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

const INITIAL_FORM: FormState = {
  name: "",
  phone: "",
  email: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "India",
};

type Stage = "form" | "creating-order" | "opening-payment" | "verifying";

function validate(form: FormState): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {};

  if (!form.name.trim()) errors.name = "Name is required.";
  if (!PHONE_PATTERN.test(form.phone.trim())) {
    errors.phone = "Enter a valid 10-15 digit phone number.";
  }
  if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (!form.line1.trim()) errors.line1 = "Address is required.";
  if (!form.city.trim()) errors.city = "City is required.";
  if (!form.state.trim()) errors.state = "State is required.";
  if (!form.postalCode.trim()) errors.postalCode = "Postal code is required.";
  if (!form.country.trim()) errors.country = "Country is required.";

  return errors;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, cartToken, isLoading, refreshCart } = useCart();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [stage, setStage] = useState<Stage>("form");
  const [order, setOrder] = useState<CheckoutResult | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function startPayment(createdOrder: CheckoutResult) {
    setPaymentError(null);
    setStage("opening-payment");

    try {
      await loadRazorpayScript();

      const paymentOrder = await createPaymentOrder(
        createdOrder.orderNumber,
        createdOrder.orderToken
      );

      const razorpay = new window.Razorpay({
        key: paymentOrder.keyId,
        // Razorpay's widget wants paise; this is a fixed unit conversion
        // for display only -- the amount actually charged is whatever
        // Razorpay already has stored against razorpayOrderId
        // server-side, not anything sent from this browser.
        amount: Math.round(Number(paymentOrder.amount) * 100),
        currency: paymentOrder.currency,
        name: "Aaranya Textiles & Living",
        description: `Order ${createdOrder.orderNumber}`,
        order_id: paymentOrder.razorpayOrderId,
        prefill: {
          name: form.name,
          email: form.email || undefined,
          contact: form.phone,
        },
        theme: { color: "#4b5138" },
        modal: {
          ondismiss: () => {
            setStage("form");
            setPaymentError(
              "Payment was not completed. You can try again below."
            );
          },
        },
        handler: (response: RazorpaySuccessResponse) => {
          void handlePaymentSuccess(createdOrder, response);
        },
      });

      razorpay.on("payment.failed", () => {
        setStage("form");
        setPaymentError(
          "The payment was declined. Please try again or use a different card."
        );
      });

      setStage("form");
      razorpay.open();
    } catch {
      setStage("form");
      setPaymentError(
        "Unable to start the payment. Please try again in a moment."
      );
    }
  }

  async function handlePaymentSuccess(
    createdOrder: CheckoutResult,
    response: RazorpaySuccessResponse
  ) {
    setStage("verifying");
    setPaymentError(null);

    try {
      await verifyPayment(createdOrder.orderToken, {
        orderNumber: createdOrder.orderNumber,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      });

      router.push(`/order/${createdOrder.orderNumber}`);
    } catch (error) {
      setStage("form");
      setPaymentError(
        error instanceof ApiError
          ? error.message
          : "We couldn't confirm your payment. Please contact support with your order number: " +
              createdOrder.orderNumber
      );
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setPaymentError(null);

    // Already have an order from a previous attempt -- retry payment
    // rather than creating a second order for the same cart.
    if (order) {
      await startPayment(order);
      return;
    }

    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (!cartToken) {
      setFormError("Your cart session has expired. Please add items again.");
      return;
    }

    setStage("creating-order");

    try {
      const createdOrder = await createOrder(cartToken, {
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          ...(form.email.trim() ? { email: form.email.trim() } : {}),
        },
        shippingAddress: {
          line1: form.line1.trim(),
          ...(form.line2.trim() ? { line2: form.line2.trim() } : {}),
          city: form.city.trim(),
          state: form.state.trim(),
          postalCode: form.postalCode.trim(),
          country: form.country.trim(),
        },
        paymentMethod: "online",
      });

      saveOrderToken(createdOrder.orderNumber, createdOrder.orderToken);
      setOrder(createdOrder);
      // The backend already emptied the cart as part of order creation;
      // sync this provider's in-memory state to match.
      void refreshCart();
      await startPayment(createdOrder);
    } catch (error) {
      setStage("form");
      setFormError(
        error instanceof ApiError
          ? error.message
          : "Unable to place your order right now. Please try again."
      );
    }
  }

  if (isLoading) {
    return (
      <Container className="py-14">
        <div className="h-8 w-48 animate-pulse bg-beige" />
      </Container>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <Container className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="font-serif text-2xl text-ink">
          Your cart is empty
        </h1>
        <p className="max-w-sm text-sm text-ink-muted">
          Add something to your cart before checking out.
        </p>
        <ButtonLink href="/products">Continue Shopping</ButtonLink>
      </Container>
    );
  }

  const isBusy =
    stage === "creating-order" ||
    stage === "opening-payment" ||
    stage === "verifying";

  return (
    <Container className="py-10 sm:py-14">
      <h1 className="font-serif text-3xl text-ink">Checkout</h1>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-3">
        <form onSubmit={handleSubmit} className="flex flex-col gap-8 lg:col-span-2">
          <fieldset className="flex flex-col gap-4" disabled={Boolean(order)}>
            <legend className="mb-1 font-serif text-lg text-ink">
              Customer Information
            </legend>
            <TextField
              label="Full Name"
              name="name"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              error={fieldErrors.name}
              autoComplete="name"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="Phone"
                name="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                error={fieldErrors.phone}
                autoComplete="tel"
              />
              <TextField
                label="Email (optional)"
                name="email"
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                error={fieldErrors.email}
                autoComplete="email"
              />
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4" disabled={Boolean(order)}>
            <legend className="mb-1 font-serif text-lg text-ink">
              Shipping Address
            </legend>
            <TextField
              label="Address Line 1"
              name="line1"
              value={form.line1}
              onChange={(e) => updateField("line1", e.target.value)}
              error={fieldErrors.line1}
              autoComplete="address-line1"
            />
            <TextField
              label="Address Line 2 (optional)"
              name="line2"
              value={form.line2}
              onChange={(e) => updateField("line2", e.target.value)}
              autoComplete="address-line2"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="City"
                name="city"
                value={form.city}
                onChange={(e) => updateField("city", e.target.value)}
                error={fieldErrors.city}
                autoComplete="address-level2"
              />
              <TextField
                label="State"
                name="state"
                value={form.state}
                onChange={(e) => updateField("state", e.target.value)}
                error={fieldErrors.state}
                autoComplete="address-level1"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="Postal Code"
                name="postalCode"
                value={form.postalCode}
                onChange={(e) => updateField("postalCode", e.target.value)}
                error={fieldErrors.postalCode}
                autoComplete="postal-code"
              />
              <TextField
                label="Country"
                name="country"
                value={form.country}
                onChange={(e) => updateField("country", e.target.value)}
                error={fieldErrors.country}
                autoComplete="country-name"
              />
            </div>
          </fieldset>

          {formError && <p className="text-sm text-terracotta-600">{formError}</p>}
          {paymentError && (
            <p className="text-sm text-terracotta-600">{paymentError}</p>
          )}

          <Button type="submit" disabled={isBusy} className="w-full sm:w-auto">
            {stage === "creating-order" && "Placing Order..."}
            {stage === "opening-payment" && "Opening Payment..."}
            {stage === "verifying" && "Confirming Payment..."}
            {stage === "form" && (order ? "Retry Payment" : "Proceed to Payment")}
          </Button>
        </form>

        <div className="h-fit border border-beige p-6">
          <h2 className="font-serif text-lg text-ink">Order Summary</h2>

          <ul className="mt-5 flex flex-col gap-3">
            {cart.items.map((item) => (
              <li key={item.productId} className="flex justify-between text-sm">
                <span className="text-ink-muted">
                  {item.name} × {item.quantity}
                </span>
                <span className="text-ink">{formatMoney(item.lineTotal)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 border-t border-beige pt-4">
            {cartToken && (
              <CartSummary cartToken={cartToken} cartTotal={cart.total} />
            )}
          </div>
        </div>
      </div>
    </Container>
  );
}
