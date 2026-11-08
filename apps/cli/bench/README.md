# Browser-agent bench

Claude Code and Codex driving Ardia through `ardia browse` against Aside's built-in agent. Every contender gets the
same eight local web apps and the same prompt. A checker on the app's own server grades each run.

```
tasks.json          the registry both harnesses read
tasks/benchhttp.py  the stdlib HTTP helpers every task server uses
tasks/<id>/         server.py, fixture/ (the app), selftest.py (checker proof over HTTP)
harness/bench.py    the Ardia-side harness and the plan runner (python3 -I harness/bench.py --help)
plans/*.json        plans: tasks x contenders x repeats
```

## Tasks

| id | app | ports | deadline |
| --- | --- | --- | --- |
| `calendar` | Calendar week view: add five events | 8791 | 480 s |
| `expenses` | Mail plus Expenses (drag-only reorder): build and submit the October report from receipts | 8792-8794 | 900 s |
| `research` | Developer docs with search, versions and nested pages, plus a questionnaire form | 8801-8802 | 600 s |
| `booking` | Four-step flight booking: search, fares, passengers and seat map, review | 8811 | 600 s |
| `shop` | Electronics shop: categories, specs, a coupon on another page, checkout | 8821 | 480 s |
| `grid` | Virtualized inventory sheet: filter, sort, inline edits with validation, add a row, save | 8831 | 480 s |
| `kanban` | Sprint board: HTML5 drag and drop (with a keyboard alternative), labels, due date, archive | 8841 | 480 s |
| `multitab` | Inbox, team directory and room scheduler on three origins: book the meeting | 8851-8853 | 600 s |

Each server is Python stdlib only, run from this folder as `python3 -I tasks/<id>/server.py`, on fixed ports, and
stops on SIGTERM. Each server has these endpoints:

- `POST /api/reset` puts everything back to its initial state.
- `GET /api/check` returns `{pass, matched, total, completed_at_ms, reset_at_ms, details}`.
  - `completed_at_ms` is when the user action that made the state pass happened, so a run's time to correct is
    `completed_at_ms` minus the agent's start.
  - `details` says what's wrong and what the user entered, never the expected values.
  - A run where `reset_at_ms` moved (someone reset during the run) doesn't count as a pass.

Neither endpoint is linked from the apps. `python3 -I tasks/<id>/selftest.py` (with the server running) checks
three things:
- a fresh state fails and leaks nothing;
- the correct solution passes;
- each trap fails.

## Registry

`tasks.json` is `{version, tasks: [...]}`. Each task has:

| key | meaning |
| --- | --- |
| `id`, `title` | name and display title |
| `server` | `{command, ports}`; command runs with this folder as cwd |
| `start_url` | the tab that's open and active when the run starts |
| `extra_urls` | other URLs the prompt names |
| `preopen_extra` | open `extra_urls` as background tabs too (false for every task now) |
| `reset`, `check` | `{method, url}` |
| `deadline_s` | the run is killed after this |
| `prompt` | the user's request, verbatim, the same for every contender |

The Ardia side appends one line to the prompt, naming how to reach the instance: ``Use the `ardia` command with
`--port 9371` to reach this Ardia instance.``

## Running

Copy a Release build into the bench home and run the copy. Never run the build in place (others rebuild it), and
never point the harness at `/Applications`:

```sh
mkdir -p ~/ardia-scratch/bench-proper/app
ditto apps/browser/build-engine-cli/Build/Products/Release/Ardia.app ~/ardia-scratch/bench-proper/app/Ardia.app
cd apps/cli/bench
python3 -I harness/bench.py freeze-cli
python3 -I harness/bench.py run research claude try-1 --results ~/ardia-scratch/bench-proper/results/adhoc
python3 -I harness/bench.py plan plans/full.json --dry-run
python3 -I harness/bench.py plan plans/full.json --results ~/ardia-scratch/bench-proper/results/<name>
python3 -I harness/bench.py stop
```

- **`freeze-cli`** snapshots `apps/cli` into its own venv. Every run uses that `ardia` (`--cli installed` uses
  `~/.local/bin/ardia` instead), so edits made during a plan don't leak into it.
- **Each Ardia-side run** does the following, in order:
  1. Starts the task's server.
  2. Reuses or launches one hidden instance: `open -g -n` with `ARDIA_BACKGROUND=1`, its own `ARDIA_DATA_DIR`, a
     DevTools port and `ARDIA_TEST=cdpTabsVisible`.
  3. Stops leftover `ardia browse` daemons and wipes the site notes. Every run is cold unless `--keep-notes`.
  4. Resets the task and opens `start_url` as the only tab.
  5. Installs the skill into a fresh workdir.
  6. Starts `claude -p` (stream-json) or `codex exec --json`, with the agent's own variables stripped from its
     environment.
  7. Records the check, `notes_after`, tokens, turns, commands, focus and timing in `runs/<run_id>.json`.
- **A plan** runs `tasks x contenders x repeats`, with each round rotating the task order and the contender order.
  Runs go out in parallel lanes (`--max-lanes N`, default 6; 1 runs them one at a time). A central scheduler hands
  out runs and decides when to add a lane:
  - Two runs never use the same task at once, since they'd share its server and resets, so 8 is the hard ceiling.
    Each task server is started once and shared.
  - Aside has one lane, which its contenders take in turn. Each Ardia contender can have several lanes; lane `k`
    gets its own copied app (`app-lane<k>/`), port (`port + k`), data dir and Codex home.
  - Lanes are gated on memory. Used memory is (active + wired + compressed pages) / `hw.memsize`, from `vm_stat`:
    - A new lane opens only under 70%, at least 20 s after the last one started its agent.
    - At 75% nothing new opens until memory is back under 70%.
    - Above 80%, a lane that finishes doesn't start its next run until memory is back under 75%.
    - A running run is never killed.
    - Extra lanes that sit idle for 2 minutes are quit.
  - Contenders progress together: a contender may be at most 15% of its runs ahead of the slowest one, and at most
    one round ahead (`pace_slack`, `max_round_lead` in the plan). That way no contender gets all its runs at quiet
    moments.
  - A rate limit or overloaded error counts as a harness error, is retried after 2 minutes, and drops that
    contender to one lane. Other harness errors are retried too, at most 3 times per session.
  - Every run records `lane`, `lanes_active`, `memory_used_pct_at_start` and `concurrent_runs`.
    `<results>/memory.jsonl` samples memory and the active runs every 3 s.
  - `--dry-run` prints the simulated timeline. It uses durations from the results dir if there are any, and a
    modeled memory curve.
  - `python3 -I harness/test_scheduler.py` tests the scheduler.
  - Aside contenders shell out to `node ~/ardia-scratch/aside-bench/bin/aside_run.mjs <run_id> --task <id>
    --registry tasks.json --out <results>/aside-raw --model <name> --visibility covered` (`BENCH_ASIDE_DRIVER`
    overrides the path). Their record is normalized into `runs/<run_id>.json`.
  - A plan resumes: finished runs are skipped, and runs that hit a harness error are retried.
- **`summary.json`** is rewritten after every run, in a shape the site renders directly:
  - `tasks` and `contenders` list what was run.
  - `cells[]` has one entry per task and contender: `pass_rate`, `median_time_s`, `median_time_to_correct_s`,
    `median_tokens` and `median_commands`.
  - `overall[]` gives the same figures per contender.
  - A cell has `serial_vs_parallel` when it has both runs that ran alone and runs that ran alongside others.
  - `parallel` has the peak and median memory %, the average and maximum number of lanes, and the total wall time
    (from `memory.jsonl`, summed over sessions).

## OpenCode Browse side

Contenders with `"kind": "opencode"` (`plans/opencode.json`) run the same agents, models, effort, prompt, deadline,
checks and token accounting as the Ardia side. Only the browser and its tooling differ: [OpenCode
Browse](https://github.com/anomalyco/browse), an MCP server and a Chromium extension. The extension drives tabs with
`chrome.debugger`, and the relay runs the agent's Playwright code over that CDP link.

Everything lives in `BENCH_OPENCODE_HOME` (default `~/ardia-scratch/opencode-browse`). Nothing goes into a real
browser profile or an agent's global config:

- `npm/`: `npm install --prefix … @opencode/browse`. `browse install` is never run, since it edits agent configs
  and looks for the extension in real browser profiles.
- `browsers/`: Chrome for Testing (`npx @puppeteer/browsers install chrome@stable --path …`).
- `ext/store-0.0.10/`: the Chrome Web Store build of the extension (`mfnicocicmmlkpjnaffgihfjhdgjkdjg`), unpacked
  with the store's public key so it keeps the store ID, which the relay trusts.
- `lanes/lane<k>/`: wiped before every run. It holds the Chrome profile, the relay's data root (`browse/`), its XDG
  folders, the Claude MCP config and the Codex `HOME`.

Each run does the following, in order:

1. Starts the task server and resets the task.
2. Launches a fresh headless Chrome for Testing with the extension loaded. Headless never takes focus;
   `frontmost_during_run` samples the front app every second to prove it.
3. Starts the relay with `browse serve`. Port 19990 + k, auto-update off, autostart off.
4. Pairs the extension without UI. `browse pair` mints a one-time code, and `harness/opencode_cdp.mjs` writes it with
   the relay port into the extension's storage through its service worker.
5. Opens `start_url` as the only tab and lends it to the agent with `Extensions.triggerAction`, the toolbar click a
   user makes.
6. Gives Claude `--mcp-config <lane>/mcp.json --strict-mcp-config`, and Codex `-c mcp_servers.browse.*`. That is the
   same `node cli.mjs mcp` entry `browse install` writes, plus the isolation variables. The agent sees browse's 29
   MCP tools and no skill file; browse's skill text comes only from its `skill` tool. The prompt's last line is ``Use
   the `browse` MCP tools to reach this browser.``
7. Records the same fields as an Ardia run. `commands` counts browse MCP calls plus shell commands
   (`mcp_calls`, `shell_commands`, `browse_calls_by_tool` and `browse_calls` give the split). For Claude,
   `agent_saw` holds the tool list from its init event.
8. Quits Chrome and the relay.

One run: `python3 -I harness/bench.py run calendar claude try-1 --side opencode --results …`.

Scratch lives in `BENCH_HOME` (default `~/ardia-scratch/bench-proper`): `app/`, `cli/`, `devbin/`, `data-ardia/`,
`work/`, `state/`, `logs/` and `results/`, plus `app-lane<k>/`, `data-ardia-lane<k>/` and `codex-home-lane<k>/`
for extra lanes.
