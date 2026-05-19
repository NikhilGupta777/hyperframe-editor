import { GATE_CATALOG } from "@/lib/presets";

type GateId = keyof typeof GATE_CATALOG;

interface Props {
  status: Record<string, "pass" | "warn" | "fail" | "skip"> | null;
}

export function GateBadges({ status }: Props) {
  const ids = Object.keys(GATE_CATALOG) as GateId[];
  return (
    <div className="flex flex-wrap gap-1 text-[10px] uppercase tracking-wider">
      {ids.map((id) => {
        const s = status?.[id] ?? "skip";
        const palette =
          s === "pass"
            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
            : s === "warn"
              ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
              : s === "fail"
                ? "bg-red-500/20 text-red-300 border-red-500/40"
                : "bg-muted/20 text-muted/80 border-muted/40";
        return (
          <span
            key={id}
            title={`${id}: ${GATE_CATALOG[id].name}`}
            className={`rounded border px-1.5 py-0.5 ${palette}`}
          >
            {id}
          </span>
        );
      })}
    </div>
  );
}
