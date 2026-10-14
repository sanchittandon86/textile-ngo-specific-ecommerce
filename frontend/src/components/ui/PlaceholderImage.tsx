// No real product/lifestyle photography exists yet (every product's
// image_url is currently null). This renders a clearly-labeled stand-in
// rather than a broken <img> or a generic gradient, so it's obvious
// what needs a real photo later and where.
export function PlaceholderImage({
  label,
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 bg-beige text-ink-soft ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="h-8 w-8 opacity-60"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
        />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m4 17 5-5 3 3 4-4 4 4" />
      </svg>
      {label && (
        <span className="px-3 text-center text-[11px] tracking-wide uppercase">
          {label}
        </span>
      )}
    </div>
  );
}
