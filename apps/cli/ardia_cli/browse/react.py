import json

from ardia_cli.browse.commands import Result, command, evaluate_main, need, parse
from ardia_cli.browse.errors import BrowseError, Usage

HOOK = r"""
(() => {
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
  const renderers = new Map();
  const roots = new Set();
  const ids = new WeakMap();
  let nextFiber = 1;
  let nextRenderer = 1;
  const COMPOSITE = new Set([0, 1, 11, 14, 15]);
  const state = { recording: false, renders: new Map(), commits: 0, recordStart: 0, firstCommit: null, earlyCommits: 0,
    hydratedComponents: 0, suspendedEver: new Set() };
  const idOf = (fiber) => {
    let id = ids.get(fiber) || (fiber.alternate && ids.get(fiber.alternate));
    if (!id) { id = nextFiber++; ids.set(fiber, id); if (fiber.alternate) ids.set(fiber.alternate, id); }
    return id;
  };
  const nameOf = (fiber) => {
    const type = fiber.type;
    if (!type) return fiber.tag === 13 ? "Suspense" : null;
    if (typeof type === "string") return type;
    if (typeof type === "function") return type.displayName || type.name || "Anonymous";
    if (typeof type === "object") return type.displayName || (type.render && (type.render.displayName || type.render.name))
      || (type.type && (type.type.displayName || type.type.name)) || "Anonymous";
    return String(type);
  };
  const walk = (fiber, visit, depth = 0, parent = null) => {
    while (fiber) {
      const keep = COMPOSITE.has(fiber.tag) || fiber.tag === 13;
      const next = keep ? visit(fiber, depth, parent) : undefined;
      if (fiber.child) walk(fiber.child, visit, keep ? depth + 1 : depth, keep ? fiber : parent);
      fiber = fiber.sibling;
    }
  };
  const brief = (value, depth = 0) => {
    if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return value.length > 200 ? value.slice(0, 200) + "…" : value;
    if (typeof value === "function") return "ƒ " + (value.name || "anonymous");
    if (typeof value === "symbol") return value.toString();
    if (value && value.$$typeof) return "<" + (value.type && (value.type.displayName || value.type.name || value.type) || "element") + " />";
    if (depth > 1) return Array.isArray(value) ? "[…]" : "{…}";
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => brief(item, depth + 1));
    const out = {};
    for (const key of Object.keys(value).slice(0, 30)) { try { out[key] = brief(value[key], depth + 1); } catch (e) { out[key] = "?"; } }
    return out;
  };
  const allRoots = () => Array.from(roots).filter((root) => root && root.current);
  const find = (id) => {
    let found = null;
    for (const root of allRoots()) walk(root.current.child, (fiber) => { if (!found && idOf(fiber) === id) found = fiber; });
    return found;
  };
  const countRenders = (root) => {
    walk(root.current.child, (fiber) => {
      if (!COMPOSITE.has(fiber.tag)) return;
      const old = fiber.alternate;
      if (!old || old.memoizedProps !== fiber.memoizedProps || old.memoizedState !== fiber.memoizedState) {
        const name = nameOf(fiber);
        const entry = state.renders.get(name) || { name, count: 0, duration: 0 };
        entry.count += 1;
        entry.duration += fiber.actualDuration || 0;
        state.renders.set(name, entry);
      }
    });
  };
  const hook = {
    supportsFiber: true,
    renderers,
    inject(renderer) { const id = nextRenderer++; renderers.set(id, renderer); return id; },
    onCommitFiberRoot(_id, root) {
      roots.add(root);
      state.commits += 1;
      const now = performance.now();
      if (state.firstCommit === null) {
        state.firstCommit = now;
        let components = 0;
        walk(root.current.child, (fiber) => { if (COMPOSITE.has(fiber.tag)) components += 1; });
        state.hydratedComponents = components;
      }
      if (now - state.firstCommit < 2000) state.earlyCommits += 1;
      walk(root.current.child, (fiber) => { if (fiber.tag === 13 && fiber.memoizedState !== null) state.suspendedEver.add(idOf(fiber)); });
      if (state.recording) countRenders(root);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    on() {}, off() {}, emit() {}, sub() { return () => {}; },
    getFiberRoots() { return roots; },
  };
  Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { value: hook, configurable: true, writable: true, enumerable: false });
  Object.defineProperty(window, "__ardiaReact", { enumerable: false, configurable: true, value: {
    ready: () => allRoots().length > 0,
    tree() {
      const rows = [];
      for (const root of allRoots()) walk(root.current.child, (fiber, depth, parent) => {
        rows.push({ depth, id: idOf(fiber), parent: parent ? idOf(parent) : null, name: nameOf(fiber), tag: fiber.tag });
      });
      return rows;
    },
    inspect(id) {
      const fiber = find(id);
      if (!fiber) return null;
      const hooks = [];
      if (fiber.tag !== 1) {
        let cell = fiber.memoizedState;
        while (cell && hooks.length < 50) { hooks.push(brief(cell.memoizedState)); cell = cell.next; }
      }
      const source = fiber._debugSource ? fiber._debugSource.fileName + ":" + fiber._debugSource.lineNumber : null;
      return { id, name: nameOf(fiber), tag: fiber.tag, key: fiber.key, props: brief(fiber.memoizedProps),
        state: fiber.tag === 1 ? brief(fiber.memoizedState) : null, hooks, source,
        owner: fiber._debugOwner ? nameOf(fiber._debugOwner) : null };
    },
    rendersStart() { state.recording = true; state.renders = new Map(); state.recordStart = performance.now(); state.startCommits = state.commits; return true; },
    rendersStop() {
      state.recording = false;
      const rows = Array.from(state.renders.values()).sort((a, b) => b.count - a.count);
      return { commits: state.commits - (state.startCommits || 0), durationMs: performance.now() - state.recordStart, components: rows };
    },
    suspense() {
      const rows = [];
      for (const root of allRoots()) walk(root.current.child, (fiber, depth, parent) => {
        if (fiber.tag !== 13) return;
        const id = idOf(fiber);
        rows.push({ id, depth, parent: parent ? nameOf(parent) : null, suspended: fiber.memoizedState !== null,
          kind: state.suspendedEver.has(id) ? "dynamic" : "static", name: (fiber.memoizedProps && fiber.memoizedProps.name) || null });
      });
      return rows;
    },
    hydration() {
      return { duration: state.firstCommit, phases: state.earlyCommits, components: state.hydratedComponents };
    },
  } });
})();
"""


async def react_call(ctx, expression: str):
    page = await ctx.state.page()
    if "react" not in page.init_scripts.values():
        raise BrowseError("React commands need the hook installed before the page loads: `ardia browse open --enable react-devtools <url>`")
    ready = await evaluate_main(page, "!!(window.__ardiaReact && window.__ardiaReact.ready())")
    if not ready:
        raise BrowseError("No React root has committed in this page yet (is it a React app, and was it loaded after `--enable react-devtools`?)")
    return await evaluate_main(page, expression)


async def hydration(page):
    try:
        return await evaluate_main(page, "window.__ardiaReact ? window.__ardiaReact.hydration() : null")
    except BrowseError:
        return None


@command("react")
async def cmd_react(ctx, argv):
    options, args = parse(argv, {"--only-dynamic": "bool"})
    need(args, 1, "react tree | inspect <id> | renders start|stop | suspense [--only-dynamic]")
    action = args[0]
    if action == "tree":
        rows = await react_call(ctx, "window.__ardiaReact.tree()")
        lines = ["depth id parent name"] + [f"{row['depth']} {row['id']} {row['parent'] if row['parent'] is not None else '-'} {'  ' * row['depth']}{row['name']}" for row in rows]
        return Result({"components": rows}, "\n".join(lines), page_content=True)
    if action == "inspect":
        need(args, 2, "react inspect <id>")
        data = await react_call(ctx, f"window.__ardiaReact.inspect({int(args[1])})")
        if data is None:
            raise BrowseError(f"No fiber {args[1]}; run `ardia browse react tree` for current ids")
        return Result(data, json.dumps(data, ensure_ascii=False, indent=2), page_content=True)
    if action == "renders":
        need(args, 2, "react renders start|stop")
        if args[1] == "start":
            await react_call(ctx, "window.__ardiaReact.rendersStart()")
            return Result({"recording": True}, "✓ Recording renders")
        if args[1] == "stop":
            data = await react_call(ctx, "window.__ardiaReact.rendersStop()")
            lines = [f"commits: {data['commits']}  duration: {data['durationMs']:.0f}ms"]
            lines += [f"{row['count']:>5}  {row['name']}" for row in data["components"][:50]]
            return Result(data, "\n".join(lines))
        raise Usage("Usage: ardia browse react renders start|stop")
    if action == "suspense":
        rows = await react_call(ctx, "window.__ardiaReact.suspense()")
        if options.get("only_dynamic"):
            rows = [row for row in rows if row["kind"] == "dynamic"]
        dynamic = [row for row in rows if row["kind"] == "dynamic"]
        static = [row for row in rows if row["kind"] == "static"]
        lines = [f"boundaries: {len(rows)}  dynamic: {len(dynamic)}  static: {len(static)}"]
        for title, group in (("dynamic", dynamic), ("static", static)):
            if group:
                lines.append(f"{title}:")
                lines += [f"  #{row['id']} in {row['parent'] or 'root'}{' (suspended now)' if row['suspended'] else ''}" for row in group]
        return Result({"boundaries": rows, "dynamic": len(dynamic), "static": len(static)}, "\n".join(lines))
    raise Usage(f"Unknown react subcommand: {action}")
