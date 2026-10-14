// Copy is intentionally kept as a simple editable array.
const ANNOUNCEMENTS: string[] = [
  "Handcrafted with care",
  "Made for everyday living",
  "Easy returns",
];

export function AnnouncementBar() {
  return (
    <div className="bg-olive-800 py-2 text-center text-xs tracking-wide text-sage-100">
      <p className="mx-auto max-w-7xl px-4">
        {ANNOUNCEMENTS.join("  •  ")}
      </p>
    </div>
  );
}
