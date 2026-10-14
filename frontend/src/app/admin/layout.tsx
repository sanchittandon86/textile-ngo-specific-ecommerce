import type { Metadata } from "next";
import { AuthProvider } from "@/lib/admin/AuthContext";

export const metadata: Metadata = {
  // `absolute` bypasses the root layout's "%s | Aaranya..." title
  // template -- without it, this becomes "Admin | Aaranya... | Aaranya...".
  title: { absolute: "Admin | Aaranya Textiles & Living" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
