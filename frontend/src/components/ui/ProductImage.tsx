import Image from "next/image";
import { PlaceholderImage } from "./PlaceholderImage";

export function ProductImage({
  src,
  alt,
  className = "",
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return <PlaceholderImage label={alt} className={className} />;
  }

  return (
    <div className={`relative overflow-hidden bg-beige ${className}`}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
        className="object-cover"
      />
    </div>
  );
}
