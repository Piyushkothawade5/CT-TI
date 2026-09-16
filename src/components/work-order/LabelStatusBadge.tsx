import type { LabelProgress } from "@/lib/label-progress";

// "onLight": dark-on-white text-darkness scale (unprinted lightest → printed darkest).
// "onDark": light-on-dark scale for the blue form headers, where the analog of
// "darker" is a brighter/more-opaque white (unprinted faintest → printed solid).
type Tone = "onLight" | "onDark";

export function LabelStatusBadge({
  progress,
  tone = "onLight",
  size = "sm",
}: {
  progress: LabelProgress;
  tone?: Tone;
  size?: "sm" | "md";
}) {
  const onDark = tone === "onDark";
  const sizeClass = size === "md" ? "text-sm" : "text-[11px]";

  if (progress.kind === "none") {
    return <span className={`${sizeClass} ${onDark ? "text-white/40" : "text-gray-300"}`}>—</span>;
  }
  if (progress.kind === "pending") {
    return (
      <span className={`${sizeClass} ${onDark ? "text-white/50" : "text-gray-400"}`}>
        0/{progress.total} not printed
      </span>
    );
  }
  if (progress.kind === "partial") {
    const ratio = progress.issued / progress.total;
    const lightClass = ratio >= 0.6 ? "text-white/90" : "text-white/75";
    const darkColor = ratio >= 0.6 ? "#374151" /* gray-700 */ : "#4b5563"; /* gray-600 */
    return (
      <span
        className={`whitespace-nowrap ${sizeClass} ${onDark ? lightClass : ""}`}
        style={onDark ? undefined : { color: darkColor }}
      >
        {progress.issued}/{progress.total} printed
        <span className={`ml-1 ${onDark ? "text-white/60" : "text-gray-400"}`}>· till {progress.seq}</span>
      </span>
    );
  }
  // Fully printed — most prominent.
  return <span className={`${sizeClass} ${onDark ? "text-white" : "text-gray-900"}`}>Printed</span>;
}
