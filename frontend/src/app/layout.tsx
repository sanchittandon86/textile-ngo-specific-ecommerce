import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Aaranya Textiles & Living",
    template: "%s | Aaranya Textiles & Living",
  },
  description:
    "Handcrafted textiles for a calmer home -- hand block printed bedsheets, pillow covers, bags and more, made with skilled artisans across India.",
};

// Intentionally minimal: the public storefront's nav/footer/cart
// provider live in app/(storefront)/layout.tsx instead, so the /admin
// section (sibling of (storefront), also under this root) never
// renders storefront chrome or triggers a guest-cart fetch.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} h-full`}>
      <body className="flex min-h-full flex-col bg-ivory text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
