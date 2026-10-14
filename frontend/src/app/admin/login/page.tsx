"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/admin/AuthContext";
import { AuthApiError } from "@/lib/admin/auth-service";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { login } = useAuth();
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email.trim().toLowerCase(), password);
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "Unable to log in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm border border-beige bg-ivory p-8">
        <p className="text-xs font-medium tracking-[0.16em] text-olive-700 uppercase">
          Aaranya Admin
        </p>
        <h1 className="mt-2 font-serif text-2xl text-ink">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sign in to manage the store.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 border border-terracotta-500 bg-terracotta-400/10 px-3 py-2 text-sm text-terracotta-600"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-medium tracking-wide text-ink-muted uppercase">
              Email address
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="border border-beige-dark bg-ivory px-3.5 py-2.5 text-sm text-ink focus:border-olive-600 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-medium tracking-wide text-ink-muted uppercase">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                className="w-full border border-beige-dark bg-ivory px-3.5 py-2.5 pr-16 text-sm text-ink focus:border-olive-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-3 text-xs text-ink-muted hover:text-olive-700"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 bg-olive-700 py-3 text-xs font-medium tracking-[0.14em] text-ivory uppercase transition-colors hover:bg-olive-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
