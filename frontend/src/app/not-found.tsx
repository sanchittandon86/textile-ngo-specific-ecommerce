import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <Container className="flex flex-col items-center gap-4 py-28 text-center">
      <p className="font-serif text-5xl text-ink">404</p>
      <h1 className="font-serif text-2xl text-ink">Page not found</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        We couldn&apos;t find what you were looking for. It may have been
        moved or is no longer available.
      </p>
      <ButtonLink href="/products">Continue Shopping</ButtonLink>
    </Container>
  );
}
