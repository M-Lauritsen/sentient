# SENTIENT · local Copilot activity

SENTIENT is a local-only Three.js activity visualizer. It reads Copilot's
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
- **Sessions:** Live-observed work is marked RUNNING, or RUNNING · UNVERIFIED
  after 45 seconds without a journal event. Coverage gaps are shown as unknown
  rather than presenting stale status. Session handles are opaque; titles and
  paths are not displayed.
- **Activity scene:** Pulses represent observed work, not hidden cognition.
  Waiting pauses pulses. If work ends without a journal end event, pulses may
  continue until SENTIENT observes a terminal event or loses/re-baselines the
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
  buckets. Delegated branches use the subagent role, failed branches the error
  role, and existing waiting cues the waiting role. Status colors are unchanged.
- **Recent activity:** The HUD strip stacks aggregate received category counts
  across a rolling 10 minutes (120 × 5-second buckets), with the right edge at
  now. It has no per-session attribution or server history, and no backfill.
  It starts loading, then distinguishes no received activity from unknown
  coverage. Hatching marks pre-observation history, disconnection/source gaps,
  hidden-tab discard and partial buckets; missing coverage is never zero.
  Events during a coverage gap are not counted. Counts live only in fixed-size
  browser memory; the strip redraws at most twice per second.

“Quiet · not verified idle” means SENTIENT observed no fresh active interval; it
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
The current journal sample did not include that event or
`assistant.reasoning`, so those details may not appear. The journal format is
internal and can change.

## Editing visual settings

Edit the numbers in **`visual-settings.mjs`**, save, then refresh the browser
(hard refresh if it still shows an older module). No build or server restart is
needed. This is public, browser-loaded configuration: never put secrets in it.
There are no on-screen sliders or persisted overrides; the file is the only
source of these visual settings.

The commented sections cover node size/brightness/whiteness; pulse head size,
trail spacing and speed; local completion spread, hops, branching, seeds and
intensity; and scene bloom, edge fade and ambient glow. Each number documents
its default, units and a useful range. Ranges are guidance, not automatic
clamps: use finite nonnegative numbers, integer hop/count values, and a branch
chance between 0 and 1. Start with small edits and reload to compare.
The shipped defaults preserve the current tuning, including completion head
size **3.0**, active node growth **2.0**, and bright local completion branching
without shockwaves, camera shake, ripples or completion-triggered global flashes.

Category colors remain in **`activity-colors.mjs`**. Structural geometry and
fixed buffer capacities (including pulse/trail counts) remain in `main.js`'s
`CFG`; they are deliberately not visual settings. Shader-facing settings are
passed as uniforms, so tuning these values does not require editing GLSL.
Activity mapping, statuses, hidden-tab discard and network/privacy behavior
are unaffected. Reloading still resets the page's in-memory activity totals.

## Privacy and limitations

SENTIENT reads `events.jsonl` files in local session folders without modifying
them. It serves the UI on `127.0.0.1` and sends only bounded event metadata,
aggregate statistics and opaque handles to the browser. It never forwards
prompts, reasoning content, tool arguments or results, raw session IDs,
agent descriptions, or file paths. Tool names may still reveal internal
integrations, so inspect them before sharing screenshots.

This is an integration with local journal files, not a supported subscription
to all Copilot sessions. It cannot verify sessions that do not write to those
files, detect Copilot process health, or guarantee the journal format. If file
coverage is incomplete, the display reports that instead of claiming universal
idle. The server accepts no activity-writing requests and stores no history.
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

SENTIENT has no project license yet. A license must be chosen before describing
a public release as open source. The bundled Three.js dependency retains its
own MIT license; that does not license SENTIENT.
