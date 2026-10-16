import { authenticatedFetch } from "@/lib/admin/auth-service";

const API_URL = `${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/admin`;

export class AdminApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    throw new AdminApiError(response.status, payload.message || "Something went wrong");
  }

  return payload as T;
}

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  price: string;
  stock_quantity: number;
  image_url: string | null;
  is_published: boolean;
  category_id: string | null;
  category_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AdminOrderSummary {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  payment_method: string;
  customer_name: string;
  customer_phone: string;
  total_amount: string;
  currency: string;
  created_at: string;
}

export interface AdminOrderItem {
  product_id: string | null;
  product_name: string;
  product_slug: string | null;
  unit_price: string;
  quantity: number;
  line_total: string;
}

export interface AdminPaymentAttempt {
  id: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  amount: string | null;
  currency: string;
  status: "created" | "captured" | "failed";
  failure_reason: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface AdminOrderStatusEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  created_at: string;
}

export interface AdminOrderDetail {
  order: {
    id: string;
    order_number: string;
    status: string;
    payment_status: string;
    payment_method: string;
    customer_name: string;
    customer_email: string | null;
    customer_phone: string;
    shipping_address_line1: string;
    shipping_address_line2: string | null;
    shipping_city: string;
    shipping_state: string;
    shipping_postal_code: string;
    shipping_country: string;
    subtotal: string;
    shipping_fee: string;
    discount_amount: string;
    total_amount: string;
    currency: string;
    tracking_carrier: string | null;
    tracking_number: string | null;
    created_at: string;
    updated_at: string;
  };
  items: AdminOrderItem[];
  payments: AdminPaymentAttempt[];
  statusHistory: AdminOrderStatusEvent[];
}

export interface DashboardSummary {
  orders: {
    total: number;
    pending_payment: number;
    processing: number;
    fulfillment_blocked: number;
  };
  products: { total: number; published: number };
  categories: { total: number; active: number };
  paidRevenue: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await authenticatedFetch(`${API_URL}/dashboard/summary`);
  const payload = await parse<{ data: DashboardSummary }>(response);
  return payload.data;
}

export async function listAdminProducts(
  page = 1,
  limit = 20
): Promise<{ products: AdminProduct[]; pagination: Pagination }> {
  const response = await authenticatedFetch(
    `${API_URL}/products?page=${page}&limit=${limit}`
  );
  const payload = await parse<{ data: AdminProduct[]; pagination: Pagination }>(response);
  return { products: payload.data, pagination: payload.pagination };
}

export async function listAdminCategories(): Promise<AdminCategory[]> {
  const response = await authenticatedFetch(`${API_URL}/categories`);
  const payload = await parse<{ data: AdminCategory[] }>(response);
  return payload.data;
}

export async function createCategory(name: string, imageUrl?: string): Promise<AdminCategory> {
  const response = await authenticatedFetch(`${API_URL}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, imageUrl: imageUrl || undefined }),
  });
  const payload = await parse<{ data: AdminCategory }>(response);
  return payload.data;
}

export async function setCategoryActive(id: string, isActive: boolean): Promise<AdminCategory> {
  const response = await authenticatedFetch(`${API_URL}/categories/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
  const payload = await parse<{ data: AdminCategory }>(response);
  return payload.data;
}

export async function listAdminOrders(params: {
  page?: number;
  limit?: number;
  status?: string;
  paymentStatus?: string;
}): Promise<{ orders: AdminOrderSummary[]; pagination: Pagination }> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page ?? 1));
  qs.set("limit", String(params.limit ?? 20));
  if (params.status) qs.set("status", params.status);
  if (params.paymentStatus) qs.set("paymentStatus", params.paymentStatus);

  const response = await authenticatedFetch(`${API_URL}/orders?${qs}`);
  const payload = await parse<{ data: AdminOrderSummary[]; pagination: Pagination }>(response);
  return { orders: payload.data, pagination: payload.pagination };
}

export async function getAdminOrderDetail(orderNumber: string): Promise<AdminOrderDetail> {
  const response = await authenticatedFetch(
    `${API_URL}/orders/${encodeURIComponent(orderNumber)}`
  );
  const payload = await parse<{ data: AdminOrderDetail }>(response);
  return payload.data;
}

export async function markOrderShipped(
  orderNumber: string,
  trackingCarrier: string,
  trackingNumber: string
): Promise<AdminOrderDetail["order"]> {
  const response = await authenticatedFetch(
    `${API_URL}/orders/${encodeURIComponent(orderNumber)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "shipped", trackingCarrier, trackingNumber }),
    }
  );
  const payload = await parse<{ data: AdminOrderDetail["order"] }>(response);
  return payload.data;
}

export async function markOrderDelivered(
  orderNumber: string
): Promise<AdminOrderDetail["order"]> {
  const response = await authenticatedFetch(
    `${API_URL}/orders/${encodeURIComponent(orderNumber)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "delivered" }),
    }
  );
  const payload = await parse<{ data: AdminOrderDetail["order"] }>(response);
  return payload.data;
}
