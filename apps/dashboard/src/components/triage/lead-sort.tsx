import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LEAD_SORTS, type LeadSort } from "@/lib/lead-sort";
export function LeadSortControl({ value, onChange }: { value: LeadSort; onChange: (value: LeadSort) => void }) {
  return <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as LeadSort)} aria-label="Sort leads" className="w-fit rounded-lg border bg-card p-0.5">
    {LEAD_SORTS.map(([id, label]) => <ToggleGroupItem key={id} value={id} className="h-7 rounded-md px-2.5 text-xs text-muted-foreground data-[state=on]:bg-foreground data-[state=on]:text-background">{label}</ToggleGroupItem>)}
  </ToggleGroup>;
}
