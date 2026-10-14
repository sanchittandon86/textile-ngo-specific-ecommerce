import { ButtonLink } from "@/components/ui/Button";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { Container } from "@/components/ui/Container";

export function BrandStory() {
  return (
    <section className="py-14 sm:py-20">
      <Container className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <PlaceholderImage
          label="Artisan at work"
          className="aspect-[4/3] w-full"
        />

        <div>
          <p className="text-xs font-medium tracking-[0.16em] text-olive-700 uppercase">
            Our Story
          </p>
          <h2 className="mt-4 font-serif text-3xl leading-tight text-ink">
            Rooted in tradition.
            <br />
            Made for today.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-ink-muted">
            We work with skilled artisans across India to bring you
            beautiful, handcrafted textiles that celebrate our rich
            heritage and fit into modern homes.
          </p>
          <div className="mt-8">
            <ButtonLink href="/products" variant="secondary">
              Our Story
            </ButtonLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
