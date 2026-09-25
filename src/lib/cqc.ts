// CQC uses the same four-tier rating scale as Ofsted, so the same badge colours read consistently across the site.
export const CQC_RATING_COLORS: Record<string, string> = {
  Outstanding: "bg-emerald-100 text-emerald-800",
  Good: "bg-lime-100 text-lime-800",
  "Requires improvement": "bg-amber-100 text-amber-800",
  Inadequate: "bg-red-100 text-red-800",
};

// The ingest stores the report's publication date as a plain ISO date (YYYY-MM-DD).
export function formatCqcDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
