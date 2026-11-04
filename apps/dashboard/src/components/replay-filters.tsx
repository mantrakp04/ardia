import { ListFilter, Plus, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useId, useState } from "react";
import {
  describeValue,
  FIELD_NAMES,
  MAX_CONDITIONS,
  OP_LABEL,
  opsFor,
  parseCondition,
  REPLAY_FIELDS,
  sameCondition,
  type ReplayCondition,
  type ReplayField,
  type ReplayMatch,
  type ReplayOp,
} from "@/lib/replay-query";
import { cn } from "@/lib/utils";

export type ReplayOptions = { device: string[]; browser: string[]; os: string[]; country: string[]; referrer: string[] };

const control = "h-8 rounded-lg border bg-card px-2.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

const SUGGESTIONS: Partial<Record<ReplayField, keyof ReplayOptions>> = { device: "device", browser: "browser", os: "os", country: "country", referrer: "referrer" };

function ValueInput({ field, value, onChange, options, onSubmit }: { field: ReplayField; value: string; onChange: (v: string) => void; options?: ReplayOptions; onSubmit: () => void }) {
  const listId = useId();
  const spec = REPLAY_FIELDS[field];
  if (spec.kind === "bool")
    return (
      <select aria-label="Value" value={value} onChange={(e) => onChange(e.target.value)} className={control}>
        <option value="yes">yes</option>
        <option value="no">no</option>
      </select>
    );
  const suggestions = SUGGESTIONS[field] ? (options?.[SUGGESTIONS[field]!] ?? []) : [];
  const placeholder =
    spec.kind === "number" ? (spec.unit ? `Number (${spec.unit})` : "Number") : spec.kind === "text" ? (field === "first_page" || field === "any_page" ? "/release-notes or utm_source" : "Text") : "Value";
  return (
    <>
      <input
        aria-label="Value"
        autoFocus
        type={spec.kind === "number" ? "number" : spec.kind === "date" ? "datetime-local" : "text"}
        min={spec.kind === "number" ? 0 : undefined}
        value={value}
        list={suggestions.length ? listId : undefined}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        className={cn(control, "w-full")}
      />
      {suggestions.length ? (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

const initialValue = (field: ReplayField) => (REPLAY_FIELDS[field].kind === "bool" ? "yes" : "");

export function AddCondition({ conditions, onAdd, options }: { conditions: ReplayCondition[]; onAdd: (c: ReplayCondition) => void; options?: ReplayOptions }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<ReplayField>("length");
  const [op, setOp] = useState<ReplayOp>("gte");
  const [value, setValue] = useState(initialValue("length"));
  const candidate = parseCondition(field, op, value);
  const duplicate = candidate ? conditions.some((c) => sameCondition(c, candidate)) : false;
  const full = conditions.length >= MAX_CONDITIONS;
  const submit = () => {
    if (!candidate || duplicate || full) return;
    onAdd(candidate);
    setValue(initialValue(field));
    setOpen(false);
  };
  const pickField = (next: ReplayField) => {
    setField(next);
    setOp(opsFor(next)[0]!);
    setValue(initialValue(next));
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" disabled={full} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed bg-card px-2.5 text-xs disabled:opacity-40">
          <ListFilter className="size-3.5" aria-hidden />
          Add filter
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className="z-50 grid w-[min(22rem,calc(100vw-2rem))] gap-2.5 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Field" value={field} onChange={(e) => pickField(e.target.value as ReplayField)} className={control}>
              {FIELD_NAMES.map((name) => (
                <option key={name} value={name}>
                  {REPLAY_FIELDS[name].label}
                </option>
              ))}
            </select>
            <select aria-label="Operator" value={op} onChange={(e) => setOp(e.target.value as ReplayOp)} className={control}>
              {opsFor(field).map((o) => (
                <option key={o} value={o}>
                  {OP_LABEL[o]}
                </option>
              ))}
            </select>
          </div>
          <ValueInput field={field} value={value} onChange={setValue} options={options} onSubmit={submit} />
          {REPLAY_FIELDS[field].kind === "date" ? <p className="text-[11px] text-muted-foreground">Times are UTC.</p> : null}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{duplicate ? "Already filtering on this." : full ? `Up to ${MAX_CONDITIONS} filters.` : ""}</span>
            <button
              type="button"
              disabled={!candidate || duplicate || full}
              onClick={submit}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-xs text-background disabled:opacity-40"
            >
              <Plus className="size-3.5" aria-hidden />
              Add
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function ConditionChips({
  conditions,
  match,
  onRemove,
  onMatch,
  onClear,
}: {
  conditions: ReplayCondition[];
  match: ReplayMatch;
  onRemove: (index: number) => void;
  onMatch: (m: ReplayMatch) => void;
  onClear: () => void;
}) {
  if (!conditions.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Active filters">
      {conditions.length > 1 ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          Match
          <span className="inline-flex rounded-md border bg-card p-0.5">
            {(["all", "any"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={match === m}
                onClick={() => onMatch(m)}
                className={cn("h-6 rounded px-2 text-[11px]", match === m ? "bg-foreground text-background" : "text-muted-foreground")}
              >
                {m === "all" ? "all (AND)" : "any (OR)"}
              </button>
            ))}
          </span>
        </span>
      ) : null}
      {conditions.map((c, i) => (
        <span key={`${c.field}-${c.op}-${c.value}`} className="inline-flex items-center gap-1">
          {i > 0 ? <span className="font-mono text-[10px] text-muted-foreground uppercase">{match === "all" ? "and" : "or"}</span> : null}
          <span className="inline-flex h-7 items-center gap-1 rounded-full border bg-card pr-1 pl-2.5">
            <span className="text-muted-foreground">{REPLAY_FIELDS[c.field].label}</span>
            <span className="text-muted-foreground">{OP_LABEL[c.op]}</span>
            <span className="max-w-48 truncate font-medium">{describeValue(c)}</span>
            <button
              type="button"
              aria-label={`Remove ${REPLAY_FIELDS[c.field].label} filter`}
              onClick={() => onRemove(i)}
              className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        </span>
      ))}
      <button type="button" onClick={onClear} className="ml-1 h-7 px-1.5 text-muted-foreground hover:text-foreground">
        Clear all
      </button>
    </div>
  );
}
