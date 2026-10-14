// Order access tokens are bearer credentials for a specific guest order
// -- persisted the same way as the cart token (localStorage), and
// deliberately never put in a URL query string (browser history,
// referer headers, server logs could all leak it).
const PREFIX = "textile_store_order_token_";

export function saveOrderToken(orderNumber: string, token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${PREFIX}${orderNumber}`, token);
}

export function getOrderToken(orderNumber: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`${PREFIX}${orderNumber}`);
}
