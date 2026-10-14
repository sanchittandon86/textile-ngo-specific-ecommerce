import type { ApiResponse, ApiSuccess } from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

if (!API_BASE_URL && typeof window === "undefined") {
  // Fails loudly at build/server-start time rather than producing
  // confusing "fetch failed" errors scattered across every page.
  console.warn(
    "NEXT_PUBLIC_API_URL is not set -- API requests will fail. See .env.example."
  );
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Forwarded to fetch's `cache` option. Defaults to "no-store" since
   * nearly everything here is live, per-request, cart/stock-dependent
   * data -- the backend is always the source of truth. */
  cache?: RequestCache;
}

// Low-level call returning the full parsed envelope (success/data, or
// success/message). Most callers want apiFetch below; this exists for
// the few endpoints that return extra top-level sibling fields beyond
// `data` (e.g. `pagination` on the product list, `count` on search), so
// one request can read both without a second round trip.
export async function apiFetchEnvelope<TData, TExtra = object>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<ApiSuccess<TData> & TExtra> {
  const { method = "GET", body, headers = {}, cache = "no-store" } = options;

  const requestHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL ?? ""}${path}`, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache,
    });
  } catch {
    throw new ApiError(
      0,
      "Unable to reach the server. Please check your connection and try again."
    );
  }

  let payload: (ApiResponse<TData> & TExtra) | undefined;

  try {
    payload = (await response.json()) as ApiResponse<TData> & TExtra;
  } catch {
    // Non-JSON response (e.g. an upstream proxy error page).
  }

  if (!response.ok || !payload || payload.success === false) {
    const message =
      (payload && payload.success === false && payload.message) ||
      "Something went wrong. Please try again.";
    throw new ApiError(response.status, message);
  }

  // Every failure path above throws, so payload is always the success
  // variant here -- TS can't see that across the compound condition.
  return payload as ApiSuccess<TData> & TExtra;
}

// Thin wrapper around fetch for the backend's { success, data } /
// { success, message } envelope. Resolves to the unwrapped `data` on
// success; throws ApiError (with the backend's real status + message)
// on failure, including network failures (status 0).
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const payload = await apiFetchEnvelope<T>(path, options);
  return payload.data;
}
