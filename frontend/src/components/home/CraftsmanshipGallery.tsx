import { Container } from "@/components/ui/Container";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

const GALLERY_LABELS = [
  "Bedsheet detail",
  "Potted plant",
  "Tote bags on display",
  "Hand block printing",
  "Dried florals",
  "Folded fabric stack",
];

export function CraftsmanshipGallery() {
  return (
    <section className="bg-cream py-14 sm:py-20">
      <Container>
        <div className="mb-8 flex items-end justify-between">
          <h2 className="font-serif text-2xl text-ink sm:text-3xl">
            A Glimpse Into Our World
          </h2>
          <a
            href="#"
            className="text-xs font-medium tracking-wide text-olive-700 uppercase hover:text-olive-800"
          >
            Follow us →
          </a>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {GALLERY_LABELS.map((label) => (
            <PlaceholderImage key={label} label={label} className="aspect-square w-full" />
          ))}
        </div>
      </Container>
    </section>
  );
}
