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

## What the display means

- While sessions are observed RUNNING, a continuous blue stream fires six
  impulse starts per second per session (up to 32 sessions). Running means
  observed work — thinking, tool execution or delegated (sub)agents — not a
  claim of hidden cognition. Only work whose start (turn start or
  `subagent.started`) was observed live counts; startup baselines never pulse.
  Running work keeps pulsing through long silence (e.g. a
  multi-minute test run) until a recorded turn end, subagent completion/failure,
  abort, error, shutdown, session idle, or a permission/user-input/elicitation
  wait. After 45 seconds without a journal event it is shown as
  **RUNNING · UNVERIFIED**. Risk: if a task crashes without writing an end
  event, its pulses can linger until the session writes another terminal
  event or SENTIENT loses/re-baselines the source. Read errors, truncation,
  backlog, malformed records and source loss drop running state; it resumes
  only from a new live start. Pulses also stop for disconnection, unavailable
  source or hidden tabs (no catch-up). They do not manufacture activity-feed
  entries; existing trails fade naturally.
- Every valid newly observed journal event triggers an impulse, including
  messages, progress/results, permissions, subagents, errors, lifecycle events,
  and unknown future event types. Only event metadata is displayed.
- Blue activity represents assistant turn starts, message and reasoning event
  types. Orange represents tools, user messages, permissions, errors, lifecycle
  changes and other events. User messages do not start or refresh ongoing
  cognition. Ongoing blue pulses require a live-observed running interval.
- The top-left impulse stream shows privacy-safe event titles, newest first.
  Older entries slide down into a bottom fade; only the latest eight are kept.
  Labels show exact bounded event types, for example `assistant.message_delta`
  or `tool.execution_progress · functions.view`. Relevant tool events also
  show the exact tool identifier when present.
  Only identifiers of 1-128 ASCII letters, digits, underscores, dots, colons,
  slashes and hyphens are accepted; missing or invalid tool names are omitted.
  Commands, file paths, arguments, results and conversation titles stay private.
  The feed follows observed events, not every rendered pulse/trail.
- Rapid events with matching type/kind/tool metadata are grouped per source
  poll. `×N` means N observed records represented by that entry, not N tool calls
  or N completed tasks. The browser combines counts once per animation frame:
  stronger impulses (logarithmic intensity, capped at eight), not a token-by-token
  animation loop. Only the latest eight labels are retained, but all incoming
  counts contribute to that frame's impulses. Multiple confirmed successes in
  one frame share one large burst. No synthetic idle activity timer is added.
- The large burst is reserved for a root `session.task_complete` event whose
  `success` is exactly `true` and `outcome` is exactly `"completed"`, during a
  fully observed turn. Turn-end, idle, final messages, errors, cancellations,
  subagent completion, and missing flags do not qualify.
- “Quiet · not verified idle” means no fresh active interval was observed. It
  does not claim every Copilot app/session is idle.

The current file sample did **not** contain `assistant.reasoning` or
`session.task_complete` records. Ordinary successful turns may therefore not
produce reasoning-specific detail or a completion burst in the installed journal format.
That is reported rather than replaced with an idle/final-message heuristic.
The file schema is internal and may change with Copilot updates.

## Privacy and source limits

The reader only enumerates direct session subdirectories and opens
`events.jsonl` read-only. At startup it baselines a bounded tail without replaying
old activity; later it incrementally parses bounded complete lines. The JSON
record is parsed transiently in memory, but only aggregate counts, fixed
statuses, event kinds (`thinking`, `step`, `completion`, `activity`), bounded
`eventType`, optional grouped `count` (1–1,000,000,000), and optional bounded
`toolName` on live tool events can cross the loopback SSE stream. Event types
must be 1–128 ASCII letters, digits, dots, underscores, colons or hyphens:
enough for journal identifiers, never arbitrary labels/content. Invalid names
are rejected and mark the poll partial. Missing/null data is safe for lifecycle
events; malformed non-object data or attribution is rejected conservatively.
Event-type and tool identifiers are the only additional detail; prompts,
reasoning, tool arguments/results, session IDs, and file paths are never
forwarded or logged. Snapshot/reconnect messages contain no event/tool deltas or
history. Startup, catch-up and source-gap recovery do not replay impulses.
Hidden tabs discard pending/incoming visuals; connection gaps clear queued
visuals. Neither replays a backlog on return.

The reader caps the scan at 512 journal files, 1 MiB of file reads per poll,
256 KiB per file per poll, 64 KiB per record, and 64 active agent/tool/wait
entries per session. Exceeding or losing coverage is shown as partial/unknown.
Event-ID deduplication retains at most 4,096 keys. Source aggregation retains at
most 64 metadata groups, flushing rather than dropping on pressure; per-poll
read limits bound total output. Snapshots are published for changed poll state,
not once per token. Browser queues retain eight labels and three counters;
the existing renderer limits remain 1,600 pulses and eight shockwaves.
After 45 seconds without a journal event, an open turn becomes unknown and is
not eligible for a success burst (it may still pulse as unverified running
work, see above). Snapshots carry `runningSessions` and
`unverifiedRunningSessions` aggregate counts; at most 64 running subagent
calls and 64 user-input waits are tracked per session.

This is a **journal-file integration**, not a supported Copilot all-session
subscription. It cannot prove that every running app session writes to this
location, enumerate open-but-silent sessions, detect Copilot process health, or
guarantee the internal file format. The UI intentionally shows the observed
journal count and coverage caveat instead of claiming universal idle. No app
sessions are created, resumed, or changed by SENTIENT.

The HTTP server binds only to `127.0.0.1`, checks exact Host and same-origin
EventSource requests, serves an explicit asset allowlist, and limits concurrent
SSE clients. It accepts no activity-writer endpoint and stores no activity
history.

## Contributing and publication safety

Run `npm test` and `npm run check:publication` before sharing changes. The
publication check flags common credentials, personal home paths, UUID/session
identifiers, local journals and planning records. It reports filenames/categories,
not matched values. It checks filenames throughout the project, excluding
dependencies and Git metadata. Content checks cover dotfiles and these text
extensions: `.js`, `.mjs`, `.cjs`, `.json`, `.md`, `.html`, `.css`, `.txt`,
`.yml`, `.yaml`, `.toml`, `.xml`, `.svg`, `.ts`. Other files, including images,
archives, binaries and extensionless non-dotfiles, require manual inspection.
It does not inspect Git history, prove that all private content is absent, or
replace GitHub secret scanning and manual review.

Use synthetic activity fixtures only. Never submit Copilot journals, screenshots
of private sessions, prompts, commands, outputs, credentials, or machine-specific
paths. Tool identifiers may reveal internal integrations: inspect what the feed
shows before sharing screenshots or recordings. Keep the server on loopback;
do not expose it through a LAN binding, tunnel or public reverse proxy.

The ignore file excludes dependencies, local plans, logs, journals, environment
files and common key/backup files. Ignore rules do not remove already tracked
files or Git history. Review `git status --short` and the staged diff before
committing, and enable GitHub secret scanning/push protection where available.
Ignore rules do not filter a manually created folder ZIP. Build release archives
from reviewed tracked files and inspect the actual distribution contents rather
than uploading the working folder (which includes installed dependencies).
If a credential has already been published, revoke/rotate it; deleting it alone
is not enough.

No project license has been selected yet. Before calling a public release
open-source, the copyright owner must choose and add a license. The bundled
Three.js dependency retains its own MIT license; this does not license SENTIENT.

Stop the local server to stop journal observation. SENTIENT does not install a
user-wide extension, change Copilot configuration, or modify journal files.
