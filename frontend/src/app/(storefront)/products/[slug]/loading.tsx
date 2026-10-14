import { Container } from "@/components/ui/Container";

export default function ProductLoading() {
  return (
    <Container className="py-10 sm:py-14">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="aspect-square w-full animate-pulse bg-beige" />
        <div className="flex flex-col gap-4">
          <div className="h-8 w-2/3 animate-pulse bg-beige" />
          <div className="h-6 w-1/4 animate-pulse bg-beige" />
          <div className="mt-4 h-20 w-full animate-pulse bg-beige" />
          <div className="mt-4 h-11 w-40 animate-pulse bg-beige" />
        </div>
      </div>
    </Container>
  );
}
