import { GATE_CATALOG } from "@/lib/presets";

type GateId = keyof typeof GATE_CATALOG;

interface Props {
  status: Record<string, "pass" | "warn" | "fail" | "skip"> | null;
}

export function GateBadges({ status }: Props) {
  const ids = Object.keys(GATE_CATALOG) as GateId[];
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const s = status?.[id] ?? "skip";
        const entry = GATE_CATALOG[id];
        const palette =
          s === "pass"
            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
            : s === "warn"
              ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
              : s === "fail"
                ? "bg-red-500/20 text-red-300 border-red-500/40"
                : "bg-muted/20 text-muted-foreground/50 border-muted/30";

        const icon  = s === "pass" ? "✓" : s === "warn" ? "!" : s === "fail" ? "✕" : "·";
        const suffix =
          s === "fail"  ? " — BLOCKING"
          : s === "warn"  ? " — warning (won't block)"
          : s === "skip"  ? " — not yet checked"
          : " — ok";

        return (
          <span
            key={id}
            title={`${id} · ${entry.rule}${suffix}`}
            className={`rounded border px-1.5 py-0.5 text-[10px] leading-none flex items-center gap-0.5 cursor-default select-none ${palette}`}
          >
            <span className="opacity-70 font-mono">{id}</span>
            <span className="opacity-40 px-0.5">·</span>
            <span className="hidden sm:inline truncate max-w-[76px]">{entry.name}</span>
            <span className="font-bold ml-0.5">{icon}</span>
          </span>
        );
      })}
    </div>
  );
}
