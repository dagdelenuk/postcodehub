export const OFSTED_RATING_COLORS: Record<string, string> = {
  Outstanding: "bg-emerald-100 text-emerald-800",
  Good: "bg-lime-100 text-lime-800",
  "Requires improvement": "bg-amber-100 text-amber-800",
  Inadequate: "bg-red-100 text-red-800",
};

// Ofsted's own CSV dates the inspection as DD/MM/YYYY; single-word ratings
// were also discontinued after Sept 2024, so showing the date matters - a
// "Good" badge from 2019 shouldn't read as a current judgement.
export function formatOfstedDate(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
