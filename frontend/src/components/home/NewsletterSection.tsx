"use client";

import { Container } from "@/components/ui/Container";

// UI only -- no newsletter backend exists yet. Submission is
// intentionally a no-op rather than faking a success state.
export function NewsletterSection() {
  return (
    <section className="bg-olive-900 py-12 text-sage-100">
      <Container className="flex flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="text-center sm:text-left">
          <h2 className="font-serif text-xl text-ivory">
            Stay close to the craft.
          </h2>
          <p className="mt-1 text-sm text-sage-100/80">
            Be the first to know about new collections, stories and special
            offers.
          </p>
        </div>

        <form
          onSubmit={(event) => event.preventDefault()}
          className="flex w-full max-w-md gap-3 sm:w-auto"
        >
          <label htmlFor="newsletter-email" className="sr-only">
            Email address
          </label>
          <input
            id="newsletter-email"
            type="email"
            placeholder="Your email address"
            className="min-w-0 flex-1 border border-sage-100/30 bg-transparent px-4 py-3 text-sm text-ivory placeholder:text-sage-100/50 focus:border-sage-100 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 bg-ivory px-5 py-3 text-xs font-medium tracking-[0.12em] text-olive-900 uppercase transition-colors hover:bg-sage-100"
          >
            Subscribe
          </button>
        </form>
      </Container>
    </section>
  );
}
