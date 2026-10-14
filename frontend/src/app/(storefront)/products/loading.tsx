import { Container } from "@/components/ui/Container";

export default function ProductsLoading() {
  return (
    <Container className="py-10 sm:py-14">
      <div className="h-9 w-40 animate-pulse bg-beige" />
      <div className="mt-8 h-12 w-full animate-pulse bg-beige" />

      <div className="mt-10 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-3">
            <div className="aspect-[4/5] w-full animate-pulse bg-beige" />
            <div className="h-4 w-3/4 animate-pulse bg-beige" />
            <div className="h-4 w-1/3 animate-pulse bg-beige" />
          </div>
        ))}
      </div>
    </Container>
  );
}
