import { ButtonLink } from "@/components/ui/Button";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { Container } from "@/components/ui/Container";

export function Hero() {
  return (
    <section className="bg-cream">
      <Container className="grid grid-cols-1 items-center gap-10 py-10 lg:grid-cols-2 lg:gap-16 lg:py-16">
        <div className="order-2 lg:order-1">
          <p className="text-xs font-medium tracking-[0.16em] text-olive-700 uppercase">
            Handcrafted textiles for a calmer home
          </p>
          <h1 className="mt-4 font-serif text-4xl leading-[1.1] text-ink sm:text-5xl">
            Bring nature into your everyday.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-ink-muted">
            Hand block printed. Thoughtfully made. Designed to add warmth,
            comfort and a touch of tradition to your home.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <ButtonLink href="/products">Shop Collection</ButtonLink>
            <ButtonLink href="/#categories" variant="secondary">
              Explore Categories
            </ButtonLink>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <PlaceholderImage
            label="Lifestyle hero photo"
            className="aspect-[4/3] w-full lg:aspect-[5/4]"
          />
        </div>
      </Container>
    </section>
  );
}
