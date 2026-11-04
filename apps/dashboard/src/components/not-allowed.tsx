import { useState } from "react";
import CloudBackground from "@/components/ruixen/cloud-background";
import { glassPanel } from "@/components/ruixen/glass-form";
import { hexclaveClientApp } from "@/lib/hexclave";
import { cn } from "@/lib/utils";

export function NotAllowed() {
  const [busy, setBusy] = useState(false);
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-12">
      <CloudBackground />
      <div className={cn("relative grid w-full max-w-[380px] justify-items-center gap-3 p-7 text-center", glassPanel)}>
        <img src="/app-icon.png" alt="" width={48} height={48} className="size-12 rounded-[13px]" />
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Not allowed</h1>
        <p className="text-sm text-foreground/60">This account can sign in, but it isn't a dashboard admin. Sign out and use the owner account.</p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await hexclaveClientApp.signOut({ redirectUrl: "/sign-in" });
          }}
          className="mt-2 w-full rounded-[14px] bg-primary py-3 text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
