// Types mirror the backend's actual wire format exactly, including its
// inconsistencies: product/category responses use raw snake_case DB
// column names, while cart/checkout/order/payment responses are
// camelCase (mapped server-side). Money fields are strings (Postgres
// NUMERIC serialized as text) -- never parse them to float for anything
// beyond display formatting; the backend is always the source of truth
// for totals.

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  message: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

// ---- Categories ----

export interface Category {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
}

// ---- Products ----

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  stock_quantity: number;
  image_url: string | null;
  category_id: string | null;
  created_at?: string;
}

export interface ProductListPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type ProductSortBy = "name" | "price" | "created_at";
export type SortOrder = "asc" | "desc";

export interface ProductListParams {
  page?: number;
  limit?: number;
  category?: string;
  sortBy?: ProductSortBy;
  order?: SortOrder;
}

// ---- Guest cart ----

export interface CreateCartData {
  cartToken: string;
  expiresAt: string;
}

export interface CartItem {
  productId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  availableStock: number;
  isPublished: boolean;
  isAvailable: boolean;
}

export interface CartSnapshot {
  items: CartItem[];
  total: string;
}

// ---- Checkout ----

export interface CheckoutSummary {
  items: CartItem[];
  subtotal: string;
  shippingFee: string;
  estimatedTotal: string;
  currency: string;
}

export interface CustomerInput {
  name: string;
  phone: string;
  email?: string;
}

export interface ShippingAddressInput {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface CheckoutRequest {
  customer: CustomerInput;
  shippingAddress: ShippingAddressInput;
  paymentMethod: "online";
}

export interface OrderItem {
  productId: string | null;
  name: string;
  slug: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export type OrderStatus =
  | "pending_payment"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "paid_fulfillment_blocked";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface CheckoutResult {
  orderNumber: string;
  orderToken: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: "online";
  items: OrderItem[];
  subtotal: string;
  shippingFee: string;
  discountAmount: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
}

// ---- Orders ----

export interface OrderDetail {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: "online";
  customer: {
    name: string;
    email: string | null;
    phone: string;
  };
  shippingAddress: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  items: OrderItem[];
  subtotal: string;
  shippingFee: string;
  discountAmount: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
}

// ---- Payments ----

export interface CreatePaymentOrderResult {
  razorpayOrderId: string;
  amount: string;
  currency: string;
  keyId: string;
  orderNumber: string;
}

export interface VerifyPaymentRequest {
  orderNumber: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface VerifyPaymentResult {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  alreadyProcessed: boolean;
}
