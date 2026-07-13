/** 147 (tenths of £m) → "£14.7m" */
export function money(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-GB");
}

export const STATUS_LABELS: Record<string, string> = {
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not in squad",
};
