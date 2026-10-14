// Ported from https://github.com/sanchittandon86/Login-application
// (auth-frontend/src/services/auth.js) -- same approach, typed and
// pointed at this project's API base URL instead of a hardcoded one.

const API_URL = `${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/auth`;

// Access token lives only in memory, never in localStorage/sessionStorage,
// so it isn't readable by an XSS payload that can read web storage.
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
}

class AuthApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

export { AuthApiError };

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    throw new AuthApiError(
      response.status,
      payload.message || "Something went wrong"
    );
  }

  return payload.data as T;
}

export async function loginAdmin(email: string, password: string) {
  const response = await fetch(`${API_URL}/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  return parseResponse<{ accessToken: string; user: AdminUser }>(response);
}

// Shared promise prevents simultaneous refresh requests.
let refreshPromise: Promise<{ accessToken: string }> | null = null;

export function refreshAccessToken(): Promise<{ accessToken: string }> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(`${API_URL}/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      const data = await parseResponse<{ accessToken: string }>(response);
      setAccessToken(data.accessToken);
      return data;
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

// Automatically refresh and retry a failed authenticated request once.
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const makeRequest = (token: string | null) => {
    const headers = new Headers(options.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...options, headers });
  };

  const response = await makeRequest(accessToken);
  if (response.status !== 401) return response;

  let refreshed: { accessToken: string };

  try {
    refreshed = await refreshAccessToken();
  } catch (error) {
    setAccessToken(null);
    throw error;
  }

  const retryResponse = await makeRequest(refreshed.accessToken);
  if (retryResponse.status === 401) setAccessToken(null);

  return retryResponse;
}

export async function getAdminProfile(): Promise<AdminUser> {
  const response = await authenticatedFetch(`${API_URL}/profile`, { method: "GET" });
  return parseResponse<AdminUser>(response);
}

export async function logoutAdmin(): Promise<void> {
  const response = await fetch(`${API_URL}/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  await parseResponse(response);
}
