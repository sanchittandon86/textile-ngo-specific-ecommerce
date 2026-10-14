import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "outline";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-olive-700 text-ivory hover:bg-olive-800 disabled:bg-olive-700/50",
  secondary:
    "bg-transparent text-olive-800 border border-olive-700 hover:bg-olive-700 hover:text-ivory",
  outline:
    "bg-transparent text-ink border border-beige-dark hover:border-olive-700 hover:text-olive-800",
};

const BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 px-6 py-3 text-xs font-medium uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-60";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

interface ButtonLinkProps {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}

export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}
