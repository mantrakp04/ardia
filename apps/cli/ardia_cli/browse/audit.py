from pathlib import Path

from ardia_cli.browse.commands import Result, command, current_or_new, navigate, normalize_url, parse
from ardia_cli.browse.errors import BrowseError

AXE_FILE = "axe.min.js"
RUN = r"""
async (context, tags) => {
  const options = { resultTypes: ["violations", "incomplete"], iframes: false };
  if (tags && tags.length) options.runOnly = { type: "tag", values: tags };
  const target = context ? document.querySelector(context) : document;
  if (context && !target) throw new Error("No element matches " + context);
  const result = await axe.run(target, options);
  const shape = (items) => items.map((item) => ({
    id: item.id, impact: item.impact, help: item.help, helpUrl: item.helpUrl, tags: item.tags, nodeCount: item.nodes.length,
    nodes: item.nodes.slice(0, 10).map((node) => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })),
  }));
  return { violations: shape(result.violations), incomplete: shape(result.incomplete),
    counts: { violations: result.violations.length, incomplete: result.incomplete.length, passes: (result.passes || []).length,
      inapplicable: (result.inapplicable || []).length } };
}
"""


def axe_source() -> str:
    here = Path(__file__).resolve().parent.parent
    candidates = [here / "vendor" / AXE_FILE]
    for parent in here.parents:
        candidates.append(parent / "node_modules" / "axe-core" / AXE_FILE)
    for candidate in candidates:
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8")
    raise BrowseError("axe-core isn't bundled with this ardia command (apps/cli/scripts/build.sh adds ardia_cli/vendor/axe.min.js)")


@command("a11y")
async def cmd_a11y(ctx, argv):
    options, args = parse(argv, {"--tags": "value", "--selector": "value"})
    if args:
        page = await current_or_new(ctx)
        await navigate(ctx, page, normalize_url(args[0]))
    else:
        page = await ctx.state.page()
    frame = ctx.state.frame_for(page) or page.main_frame
    present = await page.call("() => typeof axe !== 'undefined'", frame=frame, read=True)
    if not present:
        context = await page.world(frame)
        result = await page.send("Runtime.evaluate", {"expression": axe_source() + "\n;true", "contextId": context, "returnByValue": True}, timeout=60)
        if "exceptionDetails" in result:
            raise BrowseError("axe-core failed to load in this page")
    tags = [tag.strip() for tag in options["tags"].split(",")] if options.get("tags") else []
    data = await page.call(RUN, options.get("selector"), tags, frame=frame, timeout=120, read=True)
    lines = [f"violations: {data['counts']['violations']}  incomplete: {data['counts']['incomplete']}  passes: {data['counts']['passes']}"]
    for title, items in (("Violations", data["violations"]), ("Needs review", data["incomplete"])):
        if items:
            lines.append(f"{title}:")
            for item in items:
                lines.append(f"  [{item.get('impact') or 'n/a'}] {item['id']}: {item['help']} ({item['nodeCount']} {'node' if item['nodeCount'] == 1 else 'nodes'})")
                lines.append(f"    {item['helpUrl']}")
                for node in item["nodes"][:5]:
                    lines.append(f"    - {' > '.join(str(part) for part in node['target'])}")
    return Result(data, "\n".join(lines), page_content=True)
