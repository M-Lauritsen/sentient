# SENTIENT OS · local Copilot activity

SENTIENT OS is a local-only Three.js activity visualizer. It reads Copilot's
per-session `events.jsonl` activity files in
`%USERPROFILE%\.copilot\session-state\<session>\` read-only and serves the page
on IPv4 loopback. It does not attach to sessions, install a Copilot extension,
or change Copilot settings.

## Run

Requires Node.js 22 or newer.

```powershell
npm install
npm start
```

Open <http://127.0.0.1:43187/>. Stop with Ctrl+C. If the port is already in use,
the server fails closed; it does not choose another port or bind to the network.
`npm test` runs the synthetic source, HTTP/SSE, client, and UI-contract tests.

Three.js 0.160.0 is pinned and served locally, including its license. The page
does not load a CDN or send activity outside this machine.

## What you'll see

- **Activity feed:** Recent event types and validated tool names, grouped when
  events arrive together. Prompts, commands, file paths and results are not shown.
- **Sessions:** Live-observed work is marked RUNNING, including silent thinking,
  until a recorded end, wait, cancellation or error; a session that stops
  without recording an end can therefore linger as RUNNING. Coverage gaps are shown as unknown
  rather than presenting stale status. Session handles are opaque; titles and
  paths are not displayed. Sessions first discovered after observation began can
  show RUNNING when their journal timestamps place the work within that observation
  window; their existing events are not replayed. Sessions already running at
  startup become visible when fresh tool work, reasoning, or message deltas arrive.
- **Activity scene:** Pulses represent observed work, not hidden cognition.
  Waiting pauses pulses. If work ends without a journal end event, pulses may
  continue until SENTIENT OS observes a terminal event or loses/re-baselines the
  source.
- **Details and delegates:** Available session statistics are keyboard
  accessible and marked “since observed”; the scene can show observed delegated
  work. Reduced-motion settings are respected.
  The statistics dialog also has a separate **Activity by category · since page
  load** section: all 11 totals are page-wide, not attributed to the selected
  session. They count accepted grouped activity received while the page is
  visible with live coverage, exclude hidden/coverage gaps without backfill,
  saturate at 4,294,967,295 per category, and reset on reload. No events or totals
  are persisted.
- **Colors:** The feed, scene pulses and edges share an 11-category palette and
  legend. Colors identify activity; pulse kinds still control the existing
  reasoning/tool/completion motion. At most four category bursts fire per
  frame (including completion); completion reserves one cascade, then the highest-count categories
  keep their colors and the remainder coalesces into reasoning/tool motion
  buckets. Namespaced file and search tools use the read role. Delegated branches
  use the subagent role, failed branches the error role, and existing waiting
  cues the waiting role. Status colors are unchanged.
- **Recent activity:** The HUD strip stacks aggregate received category counts
  across a rolling 10 minutes (120 × 5-second buckets), with the right edge at
  now. It has no per-session attribution or server history, and no backfill.
  It starts loading, then distinguishes no received activity from unknown
  coverage. Hatching marks pre-observation history, disconnection/source gaps,
  hidden-tab discard and partial buckets; missing coverage is never zero.
  Events during a coverage gap are not counted. Counts live only in fixed-size
  browser memory; the strip redraws at most twice per second.
  Click the compact lower-left strip (or focus it and press Enter/Space) to
  enlarge the same live timeline in a centered dialog. Close it with the close
  button, Escape, or the backdrop to restore the compact view.

“Quiet · not verified idle” means SENTIENT OS observed no fresh active interval; it
does not mean every Copilot session is idle. A successful `session.task_complete`
event lights up a bright, branching cascade of impulses, nodes and edges within
the lattice. Grouped completions share one bounded cascade per frame, with no
shockwave, camera shake, floor ripple or completion-triggered global flash.
Live main-session `session.idle` events use the same orange network cascade,
including when idle follows `assistant.turn_end`. Idle remains lifecycle activity
in the feed, timeline and category statistics; it does not assert task success.
Only live-observed work with complete coverage qualifies, and idle after an
accepted task completion does not trigger a second cascade. Historical,
duplicate, subagent and interrupted-work idle events do not trigger it.
When a live tool call, turn or subagent ends after running at least
`impact.minMs` (default 2 s), it also fires an impact burst in its category
color, sized by how long it ran (log-scaled up to `impact.maxMs`, default 2 min):
longer runs travel more hops, spread wider and seed neighbouring nodes. Durations
come from journal timestamps; history read at startup makes no impact bursts.
The current journal sample did not include that event or
`assistant.reasoning`, so those details may not appear. The journal format is
internal and can change.

## Editing visual settings

Open **Visual settings** in the HUD to preview the `balanced`, `subtle` or
`intense` preset and edit any in-scope setting. Valid edits apply to the running
scene; invalid or incomplete values do not. **Reset preview** returns to the
last loaded file configuration. Changes remain temporary until **Export
settings** downloads a replacement `visual-settings.mjs` and you save it over
the source file. The page never writes that file or stores overrides in browser
storage.

Use **Reload from file** to read the current repository-authored
`visual-settings.mjs` without refreshing the page. Automatic reload is optional,
off by default, and checks every five seconds only while the page is visible.
If the file changes while a preview is dirty, choose **Use file** or **Keep
preview**; keeping the preview suppresses repeated prompts for that same file
version. Reload failures leave the last valid scene active and display an error.
Invalid configuration at startup is shown before the 3D scene starts.

This is public, browser-loaded configuration: never put secrets in it. Visual
changes do not alter activity data, session state, timeline history or
statistics.

All 3D appearance and animation tuning lives in these sections:

| Section | Controls |
| --- | --- |
| `camera` | Field of view, initial position, orbit center, damping, zoom limits and automatic rotation |
| `nodes` | Base sizes, brightness, colors, twinkle, whitening, excitation cap and decay |
| `pulses` | Head/trail appearance, speed, arrival energy and ordinary edge light |
| `running` | Per-session background rate, session cap, hops, spread and seed energy |
| `activity` | Grouped-burst intensity cap, spread, hops, seed energy and heat |
| `subagents` | Growth/fade timing, point sizes, branch brightness, anchor colors and retirement flashes |
| `waiting` | Marker appearance and waiting-glow breathing, color blend and opacity |
| `dust` | Point appearance, twinkle and rotation/sway |
| `floor` | Fine/coarse grid spacing, colors and ambient light pool |
| `completion`, `impact` | Existing local cascades and duration-scaled bursts |
| `scene` | Background, category light multiplier, idle edges, breathing, load response, bloom and glows |
| `effects` | Independent dust, floor, breathing, waiting glow/markers and subagent-transition switches |

The shipped values preserve the existing appearance. Inline comments describe
units, constraints and suggested ranges. Ranges are guidance, not automatic
clamps: use finite numbers, nonnegative except signed positions/rotation,
integer hop/count values, positive durations/grid spacing/load divisors, and
probabilities between 0 and 1. Decorative RGB arrays use linear 0–1 channels;
hex colors use sRGB. Start with small edits and preview to compare.
`running.pulsesPerSecondPerSession` defaults to 6 and `running.maxSessions`
defaults to 32. Raising the rate makes the background stream denser; the cap
limits how many running sessions multiply that rate. Setting either to 0
disables only this stream, not event-triggered impulses or completion cascades.
The shipped defaults preserve the current tuning, including completion head
size **3.0**, active node growth **2.0**, and bright local completion branching
without shockwaves, camera shake, ripples or completion-triggered global flashes.

Category colors remain in **`activity-colors.mjs`**. Structural geometry and
fixed buffer capacities (including pulse/trail counts) remain in `main.js`'s
`CFG`; they are deliberately not visual settings. Shader-facing settings are
passed as uniforms, so tuning these values does not require editing GLSL.
Topology, node/dust placement, branch geometry, floor mesh dimensions,
renderer resource limits, accessibility safeguards and HUD/CSS styling are
also unchanged and remain outside this file. Numeric shader math constants
(such as normalized point coordinates) are implementation details, not tuning.
Activity mapping, statuses, hidden-tab discard and network/privacy behavior
are unaffected. Visual preview and file reload preserve page-local activity
totals and timeline history; a full document refresh still resets them.

## Privacy and limitations

SENTIENT OS reads `events.jsonl` files in local session folders without modifying
them. It serves the UI on `127.0.0.1` and sends only bounded event metadata,
aggregate statistics and opaque handles to the browser. It never forwards
prompts, reasoning content, tool arguments or results, raw session IDs,
agent descriptions, or file paths. Tool names may still reveal internal
integrations, so inspect them before sharing screenshots.

This is an integration with local journal files, not a supported subscription
to all Copilot sessions. It cannot verify sessions that do not write to those
files, detect Copilot process health, or guarantee the journal format. If file
coverage is incomplete, the display reports that instead of claiming universal
idle. An unfinished journal record temporarily makes coverage unknown while the
session keeps its last observed running state; bounded records are retried
from disk without retaining their contents between polls. Running visibility
can also recover when fresh work is
observed, but an incompletely observed turn does not regain success eligibility.
Existing history alone is not proof that a session is still running.
The server accepts no activity-writing requests and stores no history.
Do not expose it through a LAN binding, tunnel, or public proxy.

## Contributing and sharing

Run `npm test` and `npm run check:publication` before sharing changes. Use
synthetic activity fixtures only; never share private journals, session
screenshots, prompts, commands, outputs, credentials, or machine-specific
paths. Review tool names in screenshots because they may reveal integrations.

The publication check is a useful filter, not a guarantee: it does not inspect
Git history or every binary/archive. Review `git status --short`, the staged
diff, and any release archive yourself; ignore rules do not remove tracked files
or history. If a credential was published, revoke or rotate it.

SENTIENT OS has no project license yet. A license must be chosen before describing
a public release as open source. The bundled Three.js dependency retains its
own MIT license; that does not license SENTIENT OS.
