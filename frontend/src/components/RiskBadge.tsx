interface Props {
  level: "high" | "medium" | "low" | null | undefined;
}

const COLORS: Record<string, string> = {
  high: "bg-red-500 text-white",
  medium: "bg-amber-400 text-white",
  low: "bg-emerald-500 text-white",
};

export function RiskBadge({ level }: Props) {
  if (!level) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${COLORS[level] ?? ""}`}
    >
      {level}
    </span>
  );
}
