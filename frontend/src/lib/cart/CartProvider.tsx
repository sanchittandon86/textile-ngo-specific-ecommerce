"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  addCartItem,
  createCart,
  emptyCart,
  getCart,
  removeCartItem,
  updateCartItemQuantity,
} from "@/lib/api/cart";
import { ApiError } from "@/lib/api/client";
import type { CartSnapshot } from "@/lib/api/types";

const CART_TOKEN_STORAGE_KEY = "textile_store_cart_token";

interface CartContextValue {
  cart: CartSnapshot | null;
  cartToken: string | null;
  itemCount: number;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  addItem: (productId: string | number, quantity: number) => Promise<void>;
  updateQuantity: (
    productId: string | number,
    quantity: number
  ) => Promise<void>;
  removeItem: (productId: string | number) => Promise<void>;
  clearCart: () => Promise<void>;
  /** Re-fetches the cart from the backend without issuing a mutation.
   * Needed after checkout: the backend empties the cart as part of
   * order creation, but this provider's in-memory state doesn't know
   * that happened until it's told to re-sync. */
  refreshCart: () => Promise<void>;
  clearError: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CART_TOKEN_STORAGE_KEY);
}

function persistToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(CART_TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(CART_TOKEN_STORAGE_KEY);
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cartToken, setCartToken] = useState<string | null>(null);
  const [cart, setCart] = useState<CartSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount, resume the stored cart (if any). An expired/unknown token
  // is discarded -- a fresh cart is created lazily on the next add-to-cart.
  // Every setState call below runs inside a .then() callback (an async
  // boundary), never synchronously in the effect body itself, including
  // the "no stored token" case.
  useEffect(() => {
    const stored = readStoredToken();

    Promise.resolve()
      .then(() => (stored ? getCart(stored) : null))
      .catch(() => {
        persistToken(null);
        return null;
      })
      .then((snapshot) => {
        if (stored && snapshot) {
          setCartToken(stored);
          setCart(snapshot);
        }
        setIsLoading(false);
      });
  }, []);

  const ensureCartToken = useCallback(async (): Promise<string> => {
    if (cartToken) return cartToken;

    const { cartToken: newToken } = await createCart();
    persistToken(newToken);
    setCartToken(newToken);
    return newToken;
  }, [cartToken]);

  const runMutation = useCallback(
    async (mutate: (token: string) => Promise<CartSnapshot>) => {
      setIsMutating(true);
      setError(null);

      try {
        const token = await ensureCartToken();
        const snapshot = await mutate(token);
        setCart(snapshot);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          // Stored token went stale mid-session; drop it so the next
          // attempt starts a fresh cart instead of looping on the error.
          persistToken(null);
          setCartToken(null);
          setCart(null);
        }

        const message =
          err instanceof ApiError
            ? err.message
            : "Something went wrong with your cart. Please try again.";
        setError(message);
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [ensureCartToken]
  );

  const addItem = useCallback(
    (productId: string | number, quantity: number) =>
      runMutation((token) => addCartItem(token, productId, quantity)),
    [runMutation]
  );

  const updateQuantity = useCallback(
    (productId: string | number, quantity: number) =>
      runMutation((token) => updateCartItemQuantity(token, productId, quantity)),
    [runMutation]
  );

  const removeItem = useCallback(
    (productId: string | number) =>
      runMutation((token) => removeCartItem(token, productId)),
    [runMutation]
  );

  const clearCart = useCallback(
    () => runMutation((token) => emptyCart(token)),
    [runMutation]
  );

  const refreshCart = useCallback(async () => {
    if (!cartToken) return;

    try {
      const snapshot = await getCart(cartToken);
      setCart(snapshot);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        persistToken(null);
        setCartToken(null);
        setCart(null);
      }
    }
  }, [cartToken]);

  const clearError = useCallback(() => setError(null), []);

  const itemCount = useMemo(
    () => cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
    [cart]
  );

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      cartToken,
      itemCount,
      isLoading,
      isMutating,
      error,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      refreshCart,
      clearError,
    }),
    [
      cart,
      cartToken,
      itemCount,
      isLoading,
      isMutating,
      error,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      refreshCart,
      clearError,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return ctx;
}
