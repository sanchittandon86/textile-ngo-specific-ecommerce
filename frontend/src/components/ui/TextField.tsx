import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
}

export function TextField({ label, name, error, className = "", ...props }: TextFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        className={`border bg-ivory px-3.5 py-2.5 text-sm text-ink focus:outline-none ${
          error
            ? "border-terracotta-500"
            : "border-beige-dark focus:border-olive-600"
        } ${className}`}
        {...props}
      />
      {error && (
        <p id={`${name}-error`} className="text-xs text-terracotta-600">
          {error}
        </p>
      )}
    </div>
  );
}
