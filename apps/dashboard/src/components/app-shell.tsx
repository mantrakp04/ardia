import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { Bug, Filter, Gauge, Globe, HeartPulse, Inbox, LogOut, MonitorPlay, RefreshCw, Settings2, Siren, Users } from "lucide-react";
import { GithubMark } from "@/components/github-mark";
import type { ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { hexclaveClientApp } from "@/lib/hexclave";
import { forgetViewer } from "@/lib/viewer-cache";
import { RANGES, RANGE_LABEL, parseRange, type RangeKey } from "@/lib/range";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Needs attention", icon: Siren },
  { to: "/users", label: "Users", icon: Users },
  { to: "/funnels", label: "Funnels", icon: Filter },
  { to: "/health", label: "Health", icon: HeartPulse },
  { to: "/performance", label: "Performance", icon: Gauge },
  { to: "/settings", label: "Settings", icon: Settings2 },
  { to: "/site", label: "Site", icon: Globe },
  { to: "/replays", label: "Replays", icon: MonitorPlay },
  { to: "/errors", label: "Errors", icon: Bug },
  { to: "/github", label: "GitHub", icon: GithubMark },
  { to: "/triage", label: "Triage", icon: Inbox },
] as const;

const SHORT: Record<RangeKey, string> = { "24h": "24h", "7d": "7d", "30d": "30d", "90d": "90d", all: "All" };

export function RangePicker({ className }: { className?: string }) {
  const range = parseRange(useSearch({ from: "/_app" }).range);
  const navigate = useNavigate();
  return (
    <ToggleGroup
      type="single"
      value={range}
      onValueChange={(value) => {
        if (value) navigate({ to: ".", search: (prev) => ({ ...prev, range: value === "7d" ? undefined : (value as RangeKey) }) });
      }}
      aria-label="Time range"
      className={cn("rounded-lg border bg-card p-0.5 shadow-none", className)}
    >
      {RANGES.map((r) => (
        <ToggleGroupItem
          key={r}
          value={r}
          aria-label={RANGE_LABEL[r]}
          className="h-7 rounded-md px-2.5 font-mono text-[11px] font-medium tracking-wide text-muted-foreground data-[state=on]:bg-foreground data-[state=on]:text-background sm:px-3"
        >
          {SHORT[r]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function NavLinks() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu className="gap-0.5">
      {NAV.map((item) => {
        const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        return (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton asChild isActive={active} tooltip={item.label} className="h-9 gap-2.5 rounded-lg text-[0.9rem] data-[active=true]:font-medium">
              <Link to={item.to} search={(prev) => ({ range: prev.range })} onClick={() => setOpenMobile(false)}>
                <item.icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function Brand() {
  return (
    <Link to="/" search={(prev) => ({ range: prev.range })} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
      <img src="/app-icon.png" alt="" className="size-8 rounded-[9px] shadow-sm" width={32} height={32} />
      <span className="grid leading-tight">
        <span className="text-[0.95rem] font-semibold tracking-[-0.01em]" style={{ fontStretch: "88%" }}>
          Ardia
        </span>
        <span className="label-mono text-muted-foreground">Dashboard</span>
      </span>
    </Link>
  );
}

function SignOutButton() {
  const queryClient = useQueryClient();
  return (
    <button
      type="button"
      onClick={async () => {
        forgetViewer();
        queryClient.clear();
        await hexclaveClientApp.signOut({ redirectUrl: "/sign-in" });
      }}
      className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-foreground/80 hover:text-foreground"
    >
      <LogOut className="size-3.5" />
      Sign out
    </button>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-64 shrink-0 flex-col gap-2 bg-sidebar px-4 pt-5 md:flex">
        <div className="mb-4 flex items-center gap-2.5">
          <img src="/app-icon.png" alt="" className="size-8 rounded-[9px]" width={32} height={32} />
          <Skeleton className="h-4 w-20" />
        </div>
        {Array.from({ length: NAV.length }, (_, i) => (
          <Skeleton key={i} className="h-8 rounded-lg" />
        ))}
      </div>
      <div className="flex-1">
        <div className="h-14 border-b" />
        <div className="mx-auto grid max-w-[1400px] gap-5 px-3 py-7 sm:px-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ email, children }: { email: string; children: ReactNode }) {
  const loading = useIsFetching() > 0;
  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas" className="border-r-0">
        <SidebarHeader className="px-3 pt-4">
          <Brand />
        </SidebarHeader>
        <SidebarContent className="px-1">
          <SidebarGroup>
            <SidebarGroupContent>
              <NavLinks />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="px-3 pb-4">
          <div className="grid gap-2 rounded-xl border bg-card/60 p-3">
            <span className="truncate text-xs text-muted-foreground" title={email}>
              {email}
            </span>
            <SignOutButton />
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md sm:px-6">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <img src="/app-icon.png" alt="" className="size-6 rounded-md" width={24} height={24} />
            <span className="text-sm font-semibold">Ardia</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <RefreshCw className={cn("size-3.5 text-muted-foreground transition-opacity", loading ? "animate-spin opacity-100" : "opacity-0")} aria-hidden />
            <RangePicker />
          </div>
        </header>
        <main className="mx-auto grid w-full max-w-[1400px] gap-4 px-3 py-5 sm:gap-5 sm:px-6 sm:py-7">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
