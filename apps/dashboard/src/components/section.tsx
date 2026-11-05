import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { RotateCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSection } from "@/lib/api";
import { parseRange, type RangeKey } from "@/lib/range";
import { cn } from "@/lib/utils";
import type { SectionData, SectionName } from "@/server/sections";

export function useRange(): RangeKey {
  return parseRange(useSearch({ strict: false }).range);
}

export function useSection<N extends SectionName>(section: N, range?: RangeKey): UseQueryResult<SectionData<N>> {
  const current = useRange();
  const r = range ?? current;
  return useQuery({
    queryKey: ["section", section, r],
    queryFn: ({ signal }) => fetchSection(section, r, signal),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function SectionError({ error, onRetry, className }: { error: unknown; onRetry: () => void; className?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className={cn("col-span-full flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-bad/25 bg-bad/[0.06] px-3 py-2.5 text-xs", className)}>
      <TriangleAlert className="size-3.5 shrink-0 text-bad" aria-hidden />
      <span className="min-w-0 flex-1 break-words text-foreground/80">Couldn't load this: {message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 font-medium hover:bg-accent"
      >
        <RotateCw className="size-3" aria-hidden />
        Retry
      </button>
    </div>
  );
}

export function Loaded<T>({
  query,
  skeleton,
  children,
  className,
}: {
  query: UseQueryResult<T>;
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
  className?: string;
}) {
  if (query.data !== undefined) {
    return (
      <div className={cn("transition-opacity duration-200", query.isPlaceholderData && "opacity-55", className)} aria-busy={query.isFetching}>
        {query.isError && !query.isFetching ? <SectionError error={query.error} onRetry={() => query.refetch()} className="mb-3" /> : null}
        {children(query.data)}
      </div>
    );
  }
  if (query.isError) return <SectionError error={query.error} onRetry={() => query.refetch()} />;
  return (
    <div className={className} aria-busy="true">
      {skeleton}
    </div>
  );
}

export function ChartSkeleton({ height = 260, legend = false }: { height?: number; legend?: boolean }) {
  return (
    <div className="grid gap-3">
      {legend ? (
        <div className="flex gap-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      ) : null}
      <div className="relative" style={{ height }}>
        <div className="absolute inset-0 flex flex-col justify-between py-2 pl-10">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-px bg-[var(--grid)]" />
          ))}
        </div>
        <Skeleton className="absolute right-2 bottom-8 left-10 h-1/2 rounded-md opacity-60" />
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-1.5 pt-6">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <Skeleton className="h-7 rounded-md" style={{ width: `${88 - i * 11}%` }} />
          <Skeleton className="h-3 w-8" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="grid gap-2.5 pt-1">
      <div className="flex gap-6">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-6">
          {Array.from({ length: columns }, (_, j) => (
            <Skeleton key={j} className={cn("h-4 flex-1", j === 0 && "flex-[2]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatsSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="grid content-start gap-2">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </>
  );
}
