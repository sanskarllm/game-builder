"use client";

import { useState } from "react";
import type { Variable } from "@/lib/vn-types";
import { normalizeMinutes } from "@/lib/vn-types";
import { parseTimeLiteral, validateExpression } from "@/lib/vn-vars";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Code2, SlidersHorizontal } from "lucide-react";

/**
 * @fileOverview Dropdown editor for a choice's condition or effect.
 *
 * The stored value is always the same expression string the engine reads, so
 * this is purely a nicer way to type one. Anything the builder can't represent
 * (nested ands/ors, hand-tuned comparisons) falls back to a raw text field
 * rather than being silently rewritten.
 */

const TIME = "time";

type Mode = "condition" | "effect";

interface Props {
  mode: Mode;
  value: string;
  variables: Variable[];
  /** Warn when gating on the clock while the clock is switched off. */
  clockEnabled?: boolean;
  onChange: (next: string) => void;
}

/** Comparators offered for the clock, in the order authors reach for them. */
const TIME_COMPARATORS = [
  { id: "gte", label: "at or after", op: ">=" },
  { id: "lt", label: "before", op: "<" },
  { id: "eq", label: "exactly at", op: "==" },
  { id: "between", label: "between", op: "" },
] as const;

const VALUE_COMPARATORS = [
  { id: "gte", label: "is at least", op: ">=" },
  { id: "lte", label: "is at most", op: "<=" },
  { id: "eq", label: "is", op: "==" },
  { id: "neq", label: "is not", op: "!=" },
  { id: "gt", label: "is more than", op: ">" },
  { id: "lt", label: "is less than", op: "<" },
] as const;

/** minutes -> "HH:MM" for an <input type="time">. */
function toTimeInput(minutes: number): string {
  const m = normalizeMinutes(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

interface Parsed {
  subject: string;
  comparator: string;
  value: string;
  /** Second bound, for the "between" form. */
  value2?: string;
}

/** Read a simple expression back into the builder, or null if it's too complex. */
function parseCondition(expr: string): Parsed | null {
  const t = (expr || "").trim();
  if (!t) return { subject: "", comparator: "gte", value: "" };

  // time >= A && time < B — the between form this builder emits.
  const between = /^\s*(\w+)\s*>=\s*(\S+)\s*&&\s*\1\s*<\s*(\S+)\s*$/.exec(t);
  if (between) {
    return { subject: between[1], comparator: "between", value: between[2], value2: between[3] };
  }

  const simple = /^\s*(\w+)\s*(>=|<=|==|!=|>|<)\s*(\S+)\s*$/.exec(t);
  if (!simple) return null;
  const [, subject, op, value] = simple;
  const all = [...TIME_COMPARATORS, ...VALUE_COMPARATORS];
  const match = all.find(c => c.op === op);
  return match ? { subject, comparator: match.id, value } : null;
}

function parseEffect(expr: string): Parsed | null {
  const t = (expr || "").trim();
  if (!t) return { subject: "", comparator: "+=", value: "" };
  const m = /^\s*(\w+)\s*(\+=|-=|=)\s*(.+?)\s*$/.exec(t);
  if (!m) return null;
  return { subject: m[1], comparator: m[2], value: m[3] };
}

export function ExpressionBuilder({ mode, value, variables, clockEnabled, onChange }: Props) {
  const parsed = mode === "condition" ? parseCondition(value) : parseEffect(value);
  // Something hand-written that the dropdowns can't express — stay in raw mode.
  const [rawMode, setRawMode] = useState(parsed === null);

  const subjects = [
    { id: TIME, label: "time (the clock)" },
    ...variables.filter(v => v.name?.trim()).map(v => ({ id: v.name, label: v.label || v.name })),
  ];

  const p: Parsed = parsed || { subject: "", comparator: mode === "condition" ? "gte" : "+=", value: "" };
  const isTime = p.subject === TIME;
  const problem = validateExpression(value, mode);
  const clockWarning =
    mode === "condition" && isTime && clockEnabled === false
      ? "The clock is switched off in Settings, so the player can't see why this is locked."
      : null;

  const emit = (next: Parsed) => {
    if (!next.subject || (!next.value && next.comparator !== "between")) {
      onChange("");
      return;
    }
    if (mode === "effect") {
      onChange(`${next.subject} ${next.comparator} ${next.value}`.trim());
      return;
    }
    if (next.comparator === "between") {
      if (!next.value || !next.value2) { onChange(""); return; }
      onChange(`${next.subject} >= ${next.value} && ${next.subject} < ${next.value2}`);
      return;
    }
    const all = [...TIME_COMPARATORS, ...VALUE_COMPARATORS];
    const op = all.find(c => c.id === next.comparator)?.op || ">=";
    onChange(`${next.subject} ${op} ${next.value}`);
  };

  const set = (patch: Partial<Parsed>) => emit({ ...p, ...patch });

  const selectClass =
    "h-7 text-[11px] rounded-md border bg-background px-1.5 min-w-0";

  /** A time field for the clock, a plain field for everything else. */
  const valueField = (which: "value" | "value2") => {
    const current = which === "value" ? p.value : p.value2 || "";
    if (isTime && !(mode === "effect" && p.comparator !== "=")) {
      const minutes = parseTimeLiteral(current);
      return (
        <input
          type="time"
          value={minutes === null ? "" : toTimeInput(minutes)}
          onChange={e => set({ [which]: e.target.value } as Partial<Parsed>)}
          className={cn(selectClass, "flex-1 min-w-[7.5rem]")}
        />
      );
    }
    return (
      <Input
        value={current}
        placeholder={isTime ? "minutes" : mode === "effect" ? "1" : "value"}
        onChange={e => set({ [which]: e.target.value } as Partial<Parsed>)}
        className="h-7 text-[11px] font-mono flex-1 min-w-[5rem]"
      />
    );
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground w-8 shrink-0">
          {mode === "condition" ? "if" : "sets"}
        </span>

        {rawMode ? (
          <Input
            value={value}
            placeholder={mode === "condition" ? "trust >= 2 && hasLantern" : "trust += 1"}
            onChange={e => onChange(e.target.value)}
            className="h-7 text-[10px] font-mono flex-1"
          />
        ) : (
          // Wrap instead of squeezing: in the 320px side panel three
          // controls on one line left ~60px each, so every dropdown
          // truncated to "choose..." / "is at lea" and could not be read.
          <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">
            <select
              value={p.subject}
              onChange={e => set({ subject: e.target.value, value: "", value2: "" })}
              className={cn(selectClass, "flex-1 min-w-[7.5rem]")}
            >
              <option value="">choose…</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>

            <select
              value={p.comparator}
              onChange={e => set({ comparator: e.target.value })}
              className={cn(selectClass, "flex-1 min-w-[7.5rem]")}
            >
              {mode === "effect"
                ? (
                  <>
                    <option value="+=">add</option>
                    <option value="-=">subtract</option>
                    <option value="=">set to</option>
                  </>
                )
                : (isTime ? TIME_COMPARATORS : VALUE_COMPARATORS).map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
            </select>

            {valueField("value")}

            {mode === "condition" && p.comparator === "between" && (
              <>
                <span className="text-[9px] text-muted-foreground">and</span>
                {valueField("value2")}
              </>
            )}
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          title={rawMode ? "Back to the simple view" : "Write the expression by hand"}
          onClick={() => setRawMode(v => !v)}
        >
          {rawMode ? <SlidersHorizontal className="w-3 h-3" /> : <Code2 className="w-3 h-3" />}
        </Button>
      </div>

      {isTime && !rawMode && mode === "effect" && p.comparator !== "=" && (
        <p className="text-[9px] text-muted-foreground pl-9">In minutes — 60 is one hour.</p>
      )}
      {problem && <p className="text-[9px] text-destructive leading-tight pl-9">{problem}</p>}
      {clockWarning && <p className="text-[9px] text-amber-500 leading-tight pl-9">{clockWarning}</p>}
    </div>
  );
}
