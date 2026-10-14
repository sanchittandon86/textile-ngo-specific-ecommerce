"use client";

import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

export default function ProductsError({ reset }: { reset: () => void }) {
  return (
    <Container className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="font-serif text-2xl text-ink">
        Something went wrong loading products.
      </h1>
      <p className="max-w-sm text-sm text-ink-muted">
        Please try again in a moment.
      </p>
      <Button onClick={reset}>Try Again</Button>
    </Container>
  );
}
