import { Link } from "@tanstack/react-router";
import { identityOf, shortId } from "@/lib/identity";
import { cn } from "@/lib/utils";

export function Avatar({ id, size = 24, className }: { id: string; size?: number; className?: string }) {
  const { avatar } = identityOf(id);
  const [a, b, c] = avatar.colors;
  return (
    <span
      aria-hidden
      className={cn("relative inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/10", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: a,
        backgroundImage: `radial-gradient(circle at 28% 24%, ${c} 0%, transparent 58%), radial-gradient(circle at 78% 82%, ${b} 0%, transparent 62%), linear-gradient(${avatar.angle}deg, ${a}, ${b})`,
      }}
    />
  );
}

export function PersonName({ id, link = true, size = 22, showId = true, className }: { id: string; link?: boolean; size?: number; showId?: boolean; className?: string }) {
  if (!id) return <span className="text-muted-foreground">Unknown</span>;
  const { name } = identityOf(id);
  const body = (
    <>
      <Avatar id={id} size={size} />
      <span className="grid min-w-0 leading-tight">
        <span className="truncate font-medium whitespace-nowrap">{name}</span>
        {showId ? <span className="truncate font-mono text-[10.5px] text-muted-foreground">{shortId(id)}</span> : null}
      </span>
    </>
  );
  const classes = cn("inline-flex min-w-0 items-center gap-2 text-left", className);
  if (!link) return <span className={classes}>{body}</span>;
  return (
    <Link
      to="/people/$id"
      params={{ id }}
      search={(prev) => ({ range: prev.range })}
      onClick={(e) => e.stopPropagation()}
      className={cn(classes, "rounded-md decoration-foreground/30 underline-offset-2 hover:[&_span.font-medium]:underline")}
    >
      {body}
    </Link>
  );
}

export function PersonInline({ id, className }: { id: string; className?: string }) {
  if (!id) return null;
  return (
    <Link
      to="/people/$id"
      params={{ id }}
      search={(prev) => ({ range: prev.range })}
      onClick={(e) => e.stopPropagation()}
      className={cn("inline-flex items-center gap-1.5 rounded-md hover:underline", className)}
    >
      <Avatar id={id} size={14} />
      <span className="font-medium text-foreground">{identityOf(id).name}</span>
      <span className="font-mono text-muted-foreground">{shortId(id)}</span>
    </Link>
  );
}
