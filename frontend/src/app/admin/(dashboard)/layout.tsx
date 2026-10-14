"use client";

// Next.js equivalent of ProtectedRoute.jsx from
// https://github.com/sanchittandon86/Login-application: that version
// used React Router's <Outlet/>/<Navigate/>, which don't exist here, so
// this guards with a redirect via useRouter instead. Same logic: wait
// for the session-restore check, then redirect if still unauthenticated.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/admin/AuthContext";
import { AdminShell } from "@/components/admin/AdminShell";

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace("/admin/login");
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ivory">
        <p className="text-sm text-ink-muted">Checking your session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect above is in flight; render nothing meaningful meanwhile.
    return null;
  }

  return <AdminShell>{children}</AdminShell>;
}
