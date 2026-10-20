# SENTIENT OS · local Copilot activity

SENTIENT OS is a local-only Three.js activity visualizer. It reads Copilot's
per-session `events.jsonl` activity files in
`%USERPROFILE%\.copilot\session-state\<session>\` read-only and serves the page
on IPv4 loopback. It does not attach to sessions, install a Copilot extension,
or change Copilot settings.

## Run

Requires Node.js 22 or newer. The optional Copilot Library additionally requires
x64 Windows and the verified local fixed-NTFS safety boundary described below.

```powershell
npm install
npm start
```

For **Library support on supported x64 Windows**, install dependencies first,
then run these opt-in builds **before** `npm start`:

```powershell
npm run build:library-helper
npm run build:library-renderer
```

The two Library builds are explicit, not install/start hooks. The helper build
uses the existing Windows .NET Framework 4.x x64 compiler; it does not install
an SDK or change execution policy. Stop your own Library-using server before
rebuilding its executable: Windows will refuse to overwrite an in-use helper.
Do not stop an unrelated process to unblock a build.

**Source alone is not a Library distribution.** Build and package the ignored
`native/bin/LibraryHelper.exe` and
`copilot/generated/library-markdown-worker.mjs` at those relative locations,
alongside the app and its locally served dependencies/licenses. Build the worker
with development dependencies installed (`npm ci --include=dev` for a lockfile
installation); esbuild is build-only, not a browser download. The worker bundles
marked 15.0.12 (MIT) and yaml 2.8.3 (ISC); the app serves their licenses locally.
`node scripts/build-library-renderer.mjs --check` checks generated-worker
freshness. See [native build/distribution details](native/README.md) and
[`scripts/build-library-renderer.mjs`](scripts/build-library-renderer.mjs).
There is no runtime helper compilation, parser download or CDN fallback.
On an unsupported platform, ordinary activity can run without the Windows
helper build; Library support must not be inferred from activity availability.

Open <http://127.0.0.1:43187/>. Stop with Ctrl+C. If the port is already in use,
the server fails closed; it does not choose another port or bind to the network.
`npm test` runs the synthetic source, HTTP/SSE, client, and UI-contract tests.
Library integration tests compile disposable helpers on supported x64 Windows
with the existing .NET Framework compiler; they do not require or replace the
application's `native/bin/LibraryHelper.exe`.

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
  Turn starts are deduplicated per interaction and agent, so reused turn numbers
  in later requests or delegated work do not hide running sessions.
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
does not mean every Copilot session is idle. If the local activity stream reports
a connection error, the source header keeps its previous text for up to 15 seconds
before showing “Reconnecting · unknown”. Reconnection attempts start immediately;
the delay only affects the warning. A valid recovery snapshot cancels the warning,
and repeated errors do not extend the grace period. Activity coverage becomes
unknown immediately. During the grace period, the scene keeps animating the
last-known session state and session displays remain in place; no activity events
are invented or counted. If the error persists for 15 seconds, stale session
indicators and delegated branches are cleared and running-state pulses stop.

A successful `session.task_complete`
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

## Application menu and workspace controls

Use the lower-right borderless **Application menu** icon to open **Library**, **Appearance**, **Workspace**
or **Help**. The menu opens upward; use the arrow keys to traverse it, Home and
End to reach its first and last item, and Escape to dismiss it and return focus
to the menu icon. The source bar is hidden until you hover over the top edge or
focus its chevron; tap the chevron to keep it open, then tap outside to dismiss it.
Coverage remains visible at the top.

Open **Workspace** to manage the docked feed, sessions and live timeline. Select
**Edit layout** to close the manager and reveal pointer drag handles. A visible
**Done** control returns to normal viewing without silently saving.
Each module's borderless ellipsis icon opens a menu with **Settings** and
**Collapse** (or **Expand**). **Settings** opens its controls inline; **Layout** offers
keyboard-operable dock, earlier/later, and Compact/Standard/Large controls while
editing. Settings are closed initially and only one module's settings opens at
a time. Close settings or press Escape to return focus to its ellipsis icon.
Module menus support arrow keys, Home/End, Escape and outside-click dismissal.
Modules can use the left, right, lower-left and bottom-centre docks. The
timeline defaults to lower left for new layouts and **Reset layout**; existing
saved placements are preserved. Lower left accepts any module, not just the
timeline, with the same movement, ordering and size controls.
Modules have transparent backgrounds and fixed content areas: Compact reserves
128px, Standard 200px and Large 320px. Live arrivals, empty states and coverage
updates do not resize them. Settings and Collapse can still intentionally
expand or shrink a panel; overflowing content stays within its selected size.
Collapsing or removing a module changes only its presentation; activity
collection, coverage, timeline history and page totals continue independently.
To add a module, choose its catalogue type, name, type-specific options and dock
in Workspace settings. New instances start with validated catalogue defaults;
names are rendered as text. The timeline remains a singleton because its live
canvas can occupy only one module.

Feed and totals settings offer **All categories** plus individual category
checkboxes. All categories includes every supported category, not unlimited
history: feeds still share the latest eight accepted entries. A partial
selection shows a mixed checkbox; clearing every category prompts you to choose
categories, rather than implying no observed activity. Redundant filter summaries
and session-state fallback messages are omitted, including the more-sessions
notice on truncated lists. Session rows still reflect the bounded projection,
not necessarily every running session. Empty session lists do not
display placeholder text; unknown coverage retains its styling and accessible
list label, alongside the page-wide coverage indicator.
Refreshes retain existing feed rows; new arrivals slide vertically into view,
shifting older rows down without resizing, fading or flipping them. Rapid arrivals
continue from the current scroll position. Reduced motion disables the slide.
The feed clips
and fades older rows without an internal scrollbar.
Density, legend and session filters are also in Settings, not the normal feed.
Changes preview immediately. **Save changes** saves the whole workspace;
closing Settings or choosing Done leaves unsaved changes visible.

Workspace profiles, dock order, sizes and module filters are stored in this
browser under `sentient-os.workspaces.v1`. They do not contain activity,
session identifiers, prompts, paths or Library content. Use **Save changes**,
**Save as**, **Rename**, **Delete profile**, and **Reset layout** in Workspace
settings. A dirty profile switch offers Save, Discard or Cancel. Storage errors
leave the current layout available in memory and are reported as not saved;
corrupt stored data is preserved until **Replace corrupt workspace** is chosen.
The default profile cannot be deleted, and reset restores the default modules
without resetting observed data. Clearing this site's browser data removes
saved workspace profiles.

At narrow widths, **Workspace** opens a scrollable drawer and **Return to
scene** closes it; the desktop dock positions are not rewritten. Executable
plugins and external integrations remain intentionally deferred.

## Editing visual settings

Open **Appearance** from the application menu to preview the `balanced`,
`subtle`, `intense`, `aurora`, `ember` or `monochrome` preset and edit any
in-scope setting. The new presets offer teal/cyan and warm red/orange themes,
plus a muted grayscale base scene that keeps the existing activity-category
colors recognizable. Each also has distinct glow and atmosphere effects. The
nonmodal drawer keeps the scene visible; closing it retains the current preview.
The header and preset controls scroll with the settings, leaving more room for
controls. Save as new, Save changes, Export settings and Reset preview remain
available in the footer.
Quick controls cover common adjustments, while searchable Advanced sections expose all 172
configuration paths with friendly labels, help and exact numeric inputs.
Searching shows only matching Advanced controls and hides empty sections and
duplicate Quick controls. Clear the search to restore all controls and the
previously expanded sections.
Each setting includes an always-visible description of what it changes in the
scene. Quick and Advanced use full-width rows with compact exact-value inputs
and share the same descriptions; no hover or tooltip is needed to understand a
control. Open **Details** for constraints, the configuration path and a small
**Reset to file** action. Errors and out-of-slider-range notices remain visible
without opening Details. Slider guidance is shown once above Advanced settings.
All 143 scalar numeric settings include a slider; vectors keep named X/Y/Z inputs.
Suggested slider ranges are guidance only: valid values outside them remain
unchanged and can be edited exactly. Pulse minimum/maximum and automatic
rotation direction map back to the existing configuration fields.

Valid edits preview the running scene; invalid drafts never apply. Node-count
edits preview in the draft and rebuild the network only on Enter, blur or slider
commit. **Reset to file** restores a setting, **Reset section to file** restores
that section, and **Reset preview** returns to the whole last-loaded file
configuration. Changes remain temporary until **Export settings** in the footer
downloads a replacement `visual-settings.mjs` and you save it over
the source file. Create personal presets from the current preview, select them
later, save edits, or delete them. Personal preset definitions are stored only
in this browser's local storage for this site; they are not written to
`visual-settings.mjs`, shared with other browsers, or sent to the server.
Clearing this site's browser data removes them.
Built-in presets override file values only for settings they define. Export
saves the exact current appearance as a `balanced` snapshot; the selected
preset name itself is not retained in the exported file.

While Appearance is open, **Demo activity** plays synthetic scene activity so
edits are visible without live sessions: pulses for every activity category,
hook pulses, completion cascades, duration impacts, a running stream and a
periodic waiting glow with markers. It starts each time the panel opens (unless
the system requests reduced motion), can be switched off in the panel, and
always stops when the panel closes. A **DEMO** badge is shown while it runs.
Demo pulses only drive the 3D scene; they are excluded from the impulse feed,
timeline, statistics, session counts and the HUD impulse and load readouts.

While the demo runs, hovering or keyboard-focusing a setting narrows the demo
to the effect it controls (for example hook settings show only hook pulses and
waiting settings hold the waiting glow). Resting the pointer on a numeric or
on/off setting also sweeps it gently through its suggested range in the scene,
marked **Previewing in scene**; the field, draft and saved values never change,
and clicking, typing or leaving the row stops the sweep and restores the scene.
Colours, choices, node count, random sizes and camera limits are not swept.
Under reduced motion only the focus applies. On wide windows the scene
re-centres in the area left of the open panel.
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

**Appearance → Advanced → Event effects** includes separate `hook.start`,
`hook.end` and other `hook.*` colors, shared by feed text and scene pulses.
Each has a scene-impact control from 0 (off) through 1 (normal) to 4 (maximum).
Impact changes pulse brightness and spread, not feed animation. Hook text keeps
the same smooth slide with no flashing. Hook events still count in the existing
unknown aggregate category; per-hook styling does not add statistics categories
or expose hook arguments/results. Existing appearance presets receive hook
defaults when they do not yet contain hook settings. Save a personal preset
for browser-local persistence, or export settings to save the configuration file.

Advanced tuning is organized into Camera, Network, Motion, Event effects and
Atmosphere. It retains the underlying configuration groups and exact file
formats:

| Section | Controls |
| --- | --- |
| `camera` | Field of view, initial position, orbit center, damping, zoom limits and automatic rotation |
| `nodes` | Live network count; base sizes, brightness, colors, twinkle, whitening, excitation cap and decay |
| `pulses` | Head/trail appearance, speed, arrival energy and ordinary edge light |
| `running` | Per-session background rate, session cap, hops, spread and seed energy |
| `activity` | Grouped-burst intensity cap, spread, hops, seed energy and heat |
| `hooks` | Separate start, end and fallback hook colors and scene-impact strengths |
| `subagents` | Growth/fade timing, point sizes, branch brightness, anchor colors and retirement flashes |
| `waiting` | Marker appearance and waiting-glow breathing, color blend and opacity |
| `dust` | Point appearance, twinkle and rotation/sway |
| `floor` | Fine/coarse grid spacing, colors and ambient light pool |
| `completion`, `impact` | Existing local cascades and duration-scaled bursts |
| `scene` | Background, category light multiplier, edge visibility/idle colour, breathing, load response, bloom and glows |
| `effects` | Independent dust, floor, breathing, waiting glow/markers and subagent-transition switches |

Non-hook defaults preserve the existing appearance. Inline comments describe
units, constraints and suggested ranges. Ranges are guidance, not automatic
clamps: use finite numbers, nonnegative except signed positions/rotation,
integer hop/count values, positive durations/grid spacing/load divisors, and
probabilities between 0 and 1. Decorative RGB arrays use linear 0–1 channels;
hex colors use sRGB. All colour fields in the panel use an sRGB colour picker;
linear RGB settings convert automatically for display and editing. Exports
retain the existing arrays/hex-value formats, and untouched colours retain
their original precision. Start with small edits and preview to compare.
`running.pulsesPerSecondPerSession` defaults to 6 and `running.maxSessions`
defaults to 32. Raising the rate makes the background stream denser; the cap
limits how many running sessions multiply that rate. Setting either to 0
disables only this stream, not event-triggered impulses or completion cascades.
The shipped defaults preserve the current tuning, including completion head
size **3.0**, active node growth **2.0**, and bright local completion branching
without shockwaves, camera shake, ripples or completion-triggered global flashes.

`nodes.count` sets the **actual network size**, not a visible-point filter.
It accepts integers **2–4000**; higher counts cost more
rebuild work because each node searches the network for nearest neighbours.
Count changes from panel edits, personal presets, reset, or file reload rebuild
nodes, connections and adjacency immediately, without reloading the application.
The rebuild clears in-flight visual pulses and node/edge excitation, re-anchors
session branches and waiting markers, and releases the old network geometry.
The activity connection, feed, timeline history and statistics are preserved.
An invalid value or failed rebuild leaves the previous valid network active.

`scene.edgeBaseColor` controls the idle connecting-line colour (linear RGB).
`scene.edgeVisibility` supports `'always'` (default: idle lines plus activity),
`'active'` (activity highlights and their afterglow only), and `'hidden'`
(no connecting lines). Both controls preview live. Hiding lines does not remove
connections or stop travelling pulses, node excitation, or separate subagent
branches. Active highlights keep their activity-category colours.

Category colors remain in **`activity-colors.mjs`**. Other structural geometry and
fixed buffer capacities (including pulse/trail counts) remain in `main.js`'s
`CFG`; they are deliberately not visual settings. Shader-facing settings are
passed as uniforms, so tuning these values does not require editing GLSL.
Topology rules, node/dust placement, branch geometry, floor mesh dimensions,
renderer resource limits, accessibility safeguards and HUD/CSS styling are
also unchanged and remain outside this file. Numeric shader math constants
(such as normalized point coordinates) are implementation details, not tuning.
Activity mapping, statuses, hidden-tab discard and network/privacy behavior
are unaffected. Visual preview and file reload preserve page-local activity
totals and timeline history; a full document refresh still resets them.

## Privacy and limitations

SENTIENT OS reads `events.jsonl` files in local session folders without modifying
them. It serves the UI on `127.0.0.1`. **The activity feed/SSE boundary** sends
only bounded event metadata,
aggregate statistics and opaque handles to the browser. It never forwards
prompts, reasoning content, tool arguments or results, raw session IDs,
agent descriptions, or file paths through activity. The separate, intentional
Library viewing exception below is not an anonymized activity projection.
Tool names may still reveal internal
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

## Copilot Library · intentional read-only viewing

Open **Library** in the HUD to browse local Markdown. It is a viewer of files,
**not active, installed or effective Copilot configuration**. Nothing runs:
agent instructions, skill code, commands and metadata such as `tools`, `model`
or `applyTo` remain inert text. Opening the dialog does not select a document
automatically. The existing scene, feed, palette, timeline, statistics and visual
settings remain separate; Library errors do not stop activity/SSE.

### Scope and privacy exception

The default **Default Copilot** source is the server user's
`%USERPROFILE%\.copilot`. It is implicit and cannot be unregistered. Missing or
unsafe sources show a state/warning rather than being silently removed.
**Add folder** requires deliberate path entry, mode selection and confirmation:

- **Copilot root:** inspect only that root's immediate `agents`, `skills` and
  `instructions` directories, not the rest of the root.
- **Category folder:** treat the chosen folder itself as Agents, Skills or
  Instructions; its name need not match the category.

Only case-insensitive `.md` regular files are included. Agents and instructions
recurse within their category. Each `SKILL.md` starts a skill; Markdown below
it is support material belonging to the nearest ancestor skill. Nested skills
start their own scope; Markdown without an ancestor skill appears as an
unassociated skill document. Non-Markdown assets/executables are excluded.
`session-state`, `.git`, `node_modules`, directory links/reparse targets and
unsafe files are not scanned. Paths containing a `session-state` segment cannot
be registered. Canonical duplicates and overlapping registrations are rejected,
including registering a category underneath the default source.

**This is a scoped privacy exception:** discovery reads eligible document bytes
to derive bounded titles/descriptions and lists category-relative paths. Selecting
a document intentionally sends its original Markdown/front matter to this
browser's Library pane. These may contain sensitive text or paths: they are
**not anonymized**. Titles prefer metadata `name`, then `title`, then the first
H1, then the basename (200 display characters); descriptions are bounded to 500
characters with shortening indicated. Saved absolute root paths are not restored
into the UI or included in normal API responses; only the path you deliberately
type into Add folder is displayed, then cleared on success/cancel/close.

Library content, metadata and registration settings are not added to activity,
SSE, metrics, logs, browser storage or exports. No Markdown/metadata/snapshot
cache is persisted. Do not copy them into screenshots, publication artifacts or
shared recordings; deliberate viewing is not permission to publish. The only
Library write exception is SENTIENT-owned registration settings and their
protected atomic-write/concurrency artifacts, never Copilot sources or journals.

### Reading, limits and refresh

Valid restricted YAML front matter, including unknown fields and nested inert
values, appears in **Metadata** above the body. Aliases, anchors, custom tags,
merge keys and duplicate keys are rejected. Malformed metadata shows a warning
and escaped source; an unclosed/oversized prefix retains bounded escaped source
rather than pretending it parsed successfully. Common Markdown and code are
readable but never executable. Raw HTML, images/media and embeds stay inert.
No remote resources/previews are fetched. Only pane-local heading fragments and
mapped links to already-discovered, revalidated Markdown in the same registered
category are interactive. External URLs, absolute paths, `file:` links and
unmapped/unsafe targets remain text; links cannot browse arbitrary files.

The first open scans; later opens reuse the process snapshot and its timestamp.
There are **no watchers or automatic refreshes**. Use **Refresh** after changing
files: it scans registered sources, replaces IDs and clears detail so you select
again. Pending/failed refresh keeps prior results visibly stale; changed,
missing, unsafe or expired detail cannot be treated as current and offers refresh.
Add/remove also replace the snapshot. Counts are files **shown**, not a promise
that every file was found; partial/error states and limit reasons remain visible.

Current default bounds:

| Resource | Limit |
|---|---|
| Registrations | 16 additional sources plus the default |
| Input/settings | Path 1,024 UTF-16 units; request 8 KiB; settings 64 KiB |
| Scan | Depth 12 below category; 10,000 visited entries/source; 2,000 documents total |
| Scan time/work | 5 s/source, 15 s/request; one scan/mutation and at most two active detail requests/process |
| Document/responses | 256 KiB UTF-8/document, 512 KiB detail JSON, 2 MiB snapshot JSON |
| Metadata/rendering | 16 KiB front matter, depth 32, 1,000 metadata nodes, 20,000 render-work nodes; 250 ms parse/render work budget |

Oversized documents are rejected whole, not parsed from cut-off bytes. Invalid
UTF-8, NUL/binary content, permission failures and budget exhaustion can leave
partial results while other safe sources remain usable. Busy/time-limited work
is bounded and may need retry; a successful partial scan is not a complete scan.

### Settings, confidentiality and recovery

Additional registrations persist across server restarts in
`%LOCALAPPDATA%\SENTIENT\library\settings.json` (schema version 1). They contain
canonical absolute paths, registration modes/categories and an opaque revision.
The default source is not stored. Document bytes, metadata, tokens, snapshot
IDs, labels and timestamps are not saved there. Absolute registrations are
sensitive. Dedicated settings directories/files, stable lock and private atomic
temporary files require verified current-user/SYSTEM access; administrators,
backups and compromised same-user applications are outside that boundary.
Settings are not served as static files. If the trusted app-data location or
permissions cannot be verified, there is no repository/home fallback.

Missing settings mean no additional registrations. Corrupt, unsupported or
unsafe settings are **preserved**, not silently reset; safe default viewing may
remain available while registration mutations are disabled. Valid registrations
can remain readable when a write fails. Missing/changed saved sources stay
registered with an error. Repair settings/permissions externally, with the
server stopped, then restart. Do not assume a failed or timed-out mutation was
saved: after an ambiguous acknowledgement, restart and inspect the resulting
registration list before trying again.

Writes are atomic and revision-protected across processes. If another instance
changes settings, a conflict requires restart/reload guidance rather than
overwriting it; Refresh is not a conflict-reset mechanism. Restart revalidates
saved roots and makes a new snapshot on first Library open. There is no
destructive Reset button. **Remove folder means unregister only**, requires
confirmation, and never deletes or edits the source directory or its files.

Library safety is currently supported only on x64 Windows with the maintained
native helper and a local fixed NTFS volume with a real drive mapping. Network,
removable, SUBST/unsupported mappings, reparse points/junctions and hard-linked
documents are refused. Complete opened-handle ancestor/identity checks and
content digests are revalidated at detail read. Missing/incompatible helpers or
unprovable containment/ACL/race safety fail closed for affected sources/settings,
not into a best-effort path reader. A successful activity connection does not
certify Library safety.

### Rollback without deleting user data

There is no runtime Library-disable switch. For a code rollback, stop the server
and Library work, remove/disable the Library trigger and its initialization,
routes and new asset/module mappings as a coordinated change, then restart the
original activity application. Preserve source files, journals, scene/activity
code and visual settings; ignore the versioned Library settings instead of
auto-deleting or resetting them. Unregistering sources is not required for
rollback. If you explicitly choose to remove SENTIENT's local Library settings,
stop all of your Library-using instances first, review/back up that sensitive
settings location privately, and remove only its dedicated Library settings/
artifacts yourself—not source roots, journals or visual settings. No automatic
wildcard cleanup is performed; a crash may leave a protected temporary artifact.

Release acceptance is not implied by this documentation. Run the synthetic
tests and sharing checks below; unresolved test/publication/build or manual
acceptance items block a release claim.

## Contributing and sharing

Run `npm test` and `npm run check:publication` before sharing changes. Use
synthetic activity fixtures only; never share private journals, session
screenshots, prompts, commands, outputs, credentials, or machine-specific
paths. Review tool names in screenshots because they may reveal integrations.
Library document text, metadata and saved registration paths are also sensitive;
do not include real ones in a test, screenshot, log or release archive.

Library acceptance uses `node tests/helpers/library-preview.mjs`, **not**
`npm start` or an existing user's server. It prints its own ephemeral loopback
URL and synthetic Add-folder path, explicitly isolates journals/default roots/
settings, and keeps that disposable fixture through the terminal `restart`
command. Open only that printed URL; close with Ctrl+C to stop and clean its
exact fixture. Automated regression coverage is in
`tests/library-regressions.test.mjs`; its dormant/unavailable-Library seam tests
original HTTP/SSE availability and preserved bytes, not an automatic code rollback
or a substitute for manual keyboard, screen-reader, zoom/reflow and contrast checks.

The publication check is a useful filter, not a guarantee: it does not inspect
Git history or every binary/archive. Review `git status --short`, the staged
diff, and any release archive yourself; ignore rules do not remove tracked files
or history. If a credential was published, revoke or rotate it.

SENTIENT OS has no project license yet. A license must be chosen before describing
a public release as open source. The bundled Three.js dependency retains its
own MIT license; that does not license SENTIENT OS.
