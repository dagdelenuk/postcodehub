// Small, presentation-free "top value" helpers: a one-line summary of the highest/lowest (or top N) rows in a table that
// already sits on the page, e.g. "Highest: East Sheen at £725,000. Lowest: Whitton at £480,000."

interface Row {
  label: string;
  value: number | null;
}

/** "Highest: A (fmt). Lowest: B (fmt)." - null when fewer than two rows have a value. */
export function topAndBottom(rows: Row[], format: (n: number) => string): string | null {
  const withValue = rows.filter((r): r is { label: string; value: number } => r.value !== null);
  if (withValue.length < 2) return null;
  const sorted = [...withValue].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  if (top.label === bottom.label) return null;
  return `Highest: ${top.label} at ${format(top.value)}. Lowest: ${bottom.label} at ${format(bottom.value)}.`;
}

/** "<prefix>: A (fmt), B (fmt), C (fmt)." for the top n rows by value - null when there's nothing to rank. */
export function topN(rows: Row[], n: number, format: (n: number) => string, prefix = "Highest"): string | null {
  const withValue = rows.filter((r): r is { label: string; value: number } => r.value !== null);
  if (withValue.length === 0) return null;
  const top = [...withValue].sort((a, b) => b.value - a.value).slice(0, n);
  return `${prefix}: ${top.map((r) => `${r.label} (${format(r.value)})`).join(", ")}.`;
}
