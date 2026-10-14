"use client";

// Ported from https://github.com/sanchittandon86/Login-application
// (auth-frontend/src/context/AuthContext.jsx) -- same shape and
// session-restore approach, typed for this project.
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
  getAdminProfile,
  loginAdmin,
  logoutAdmin,
  refreshAccessToken,
  setAccessToken,
  type AdminUser,
} from "./auth-service";

interface AuthContextValue {
  user: AdminUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the admin's session when the app starts. The access token
  // only lives in memory, so after a reload the only way back in is the
  // HttpOnly refresh cookie.
  useEffect(() => {
    let cancelled = false;

    refreshAccessToken()
      .then(() => getAdminProfile())
      .then((profile) => {
        if (!cancelled) setUser(profile);
      })
      .catch(() => {
        setAccessToken(null);
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await loginAdmin(email, password);
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutAdmin();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, isAuthenticated: Boolean(user), login, logout }),
    [user, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
