import { Container } from "@/components/ui/Container";

const BADGES = [
  { label: "Handcrafted with care" },
  { label: "Premium natural fabrics" },
  { label: "Pan India shipping" },
  { label: "Easy returns and support" },
];

export function TrustBadges() {
  return (
    <section className="border-y border-beige bg-cream py-8">
      <Container className="grid grid-cols-2 gap-6 text-center sm:grid-cols-4">
        {BADGES.map((badge) => (
          <div key={badge.label} className="flex flex-col items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              className="h-6 w-6 text-olive-700"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3c4 2 7 4 7 9a7 7 0 1 1-14 0c0-5 3-7 7-9Z"
              />
            </svg>
            <p className="text-xs leading-snug text-ink-muted">{badge.label}</p>
          </div>
        ))}
      </Container>
    </section>
  );
}
