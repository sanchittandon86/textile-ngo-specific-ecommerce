"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/admin/AuthContext";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/categories", label: "Categories" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.replace("/admin/login");
  }

  return (
    <div className="flex min-h-screen bg-ivory">
      <aside className="flex w-56 shrink-0 flex-col border-r border-beige bg-cream px-5 py-6">
        <div>
          <p className="font-serif text-lg text-ink">Aaranya</p>
          <p className="text-[11px] tracking-[0.2em] text-ink-muted uppercase">Admin</p>
        </div>

        <nav className="mt-8 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-olive-700 text-ivory"
                    : "text-ink-muted hover:bg-beige hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-beige pt-4">
          {user && (
            <p className="truncate text-xs text-ink-muted" title={user.email}>
              {user.name}
            </p>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="self-start text-xs tracking-wide text-ink-muted uppercase transition-colors hover:text-terracotta-600"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
