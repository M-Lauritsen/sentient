# Windows desktop app with Electron

Status: Draft proposal; not implemented or approved for implementation.

Audience: Developers familiar with SENTIENT OS.

## Goal and authorization

Make SENTIENT OS launchable as a normal Windows application without a terminal,
a separately installed Node.js runtime, or a separate browser. Support optional
automatic launch when the current Windows user signs in.

The user requested a specification. This document does not authorize dependency
changes, installation, startup registration, signing purchases, or implementation.
Approval of its outline is not approval of every proposed product decision.

## Requirement and decision status

| Item | Status |
| --- | --- |
| A Windows-launchable application and possible Windows startup support | User-stated goal |
| Write the specification in `spec-ideas/` | Confirmed deliverable |
| Electron wrapper reusing the current web app and local server | Recommended approach |
| Windows x64, per-user installer, normal visible window | Proposed v1 scope |
| Optional sign-in startup, off by default | Proposed v1 behavior |
| Closing the window exits; no background tray mode | Proposed v1 behavior |
| No automatic updates or mandatory signing for a personal-use build | Proposed v1 boundary |

All acceptance criteria below describe the proposed implementation, not observed
desktop functionality.

## Current system and reusable boundaries

| Source | Verified current behavior |
| --- | --- |
| [`package.json`](../package.json) | ESM application; Node.js 22+; `npm start` runs `server.mjs`. No Electron dependency or desktop packaging command exists. |
| [`server.mjs`](../server.mjs) | Exports `createSentientServer()` with asynchronous `start()` and `stop()`. Default address is `127.0.0.1:43187`; non-loopback host configuration is rejected. |
| [`server.mjs`](../server.mjs) | Serves explicit static/vendor allowlists and activity SSE. Accepts a `rootDir` option for application assets. Library initialization is lazy. |
| [`copilot/activity-source.mjs`](../copilot/activity-source.mjs), [`README.md`](../README.md) | Activity observation is local and read-only. Initial history is not replayed as new live activity; incomplete coverage is not verified idle. |
| [`copilot/library-native.mjs`](../copilot/library-native.mjs), [`native/README.md`](../native/README.md) | Library access uses a separately executable Windows helper and a protected filesystem boundary. |
| [`copilot/library-source.mjs`](../copilot/library-source.mjs) | Library metadata uses a Node worker. Default Library settings use a validated Windows local-app-data location under `SENTIENT\library`. |
| [`README.md`](../README.md) | Library distributions must include the built helper, generated Markdown worker, local dependencies, and licenses. |

No rewrite of the Three.js scene, activity model, Library content renderer, or HTTP
contracts is proposed. The existing browser/CLI mode remains supported.

## Proposed v1 user experience

### Install and launch

1. Install a Windows x64 package for the current user without administrator rights.
2. Launch SENTIENT OS from its Start menu shortcut.
3. See the existing interface in a standalone desktop window.

The installed app must run outside the repository, with an arbitrary working
directory and without Node.js, npm, or build tools on the user's PATH.

A launch starts the owned local server before loading the interface. A second
launch focuses/restores the existing window instead of starting another server.
Minimizing keeps the process alive; closing the sole window exits the application.
No tray icon, hidden background mode, or browser window is required for v1.

### Start with Windows

Provide a native application-menu checkbox named **Start with Windows**. Keeping
this control in the Electron main process avoids introducing renderer IPC solely
for startup preferences.

- Default: disabled; installing or first opening the app must not enable it.
- Enabling registers the installed application for the current user's sign-in.
- Disabling removes this application's registration.
- A sign-in launch opens the normal visible window, just like a manual launch.
- Registration uses a stable installed executable/launcher, not a development
  path, npm command, PowerShell window, elevated task, or pre-login service.
- Re-read Windows startup state rather than relying only on a cached preference.
  Show a disabled/policy-blocked or failed registration state honestly.
- Development runs must not create startup entries pointing into the repository.
- Upgrade and uninstall must maintain or remove this application's entry without
  touching unrelated startup entries.

This means startup at user sign-in, not boot before login. Existing sessions that
predate observation retain the current baseline/coverage semantics.

## Proposed architecture

### Process and ownership model

```text
Windows shortcut / optional sign-in registration
  -> Electron main process
       -> single-instance lock
       -> owned createSentientServer() instance on IPv4 loopback
            -> existing activity observation
            -> existing Library source, metadata worker and native helper
       -> sandboxed BrowserWindow
            -> existing HTTP assets, SSE and Library endpoints
```

Import and host the existing server in the main process for v1 rather than
spawning an npm command or requiring a second Node runtime. Do not move journal
reading or native helper execution into the renderer.

Retain `127.0.0.1:43187` initially to preserve the existing origin and documented
port-conflict behavior. A running CLI server is a port conflict, not permission
to attach to an unknown listener. Do not silently choose another port.

Resolve assets and helper locations from the installed application's resources,
not `process.cwd()`. Separate packaged read-only resources from per-user writable
state. Preserve existing Library settings-location and ACL validation; do not
replace that storage with an unvalidated Electron settings directory.

Use `start()` completion and its returned address as the prerequisite for loading
the local UI. Shut down the owned server, SSE connections, observation, workers,
and helper during exit. Handle partial-start failures as well as normal shutdown.
Repeated close/quit requests must not initiate competing cleanup operations.

### Desktop security

- Explicitly disable Node integration in the BrowserWindow, enable context
  isolation and renderer sandboxing, and retain web security.
- No general-purpose filesystem, shell, process, or arbitrary IPC capability is
  exposed to the renderer.
- Restrict top-level navigation to the owned local app. Deny unexpected new
  windows and permissions; do not automatically open URLs supplied by content.
  Preserve the Library's existing validated local-link workflow.
- Keep server loopback, Host/Origin validation, CSP, static allowlists, bounded
  projections, and Library request protections intact. Do not broaden CORS or
  disable CSP to make Electron work.
- Preserve local-only runtime behavior: no CDN, telemetry, remote content,
  analytics, or automatic update traffic is introduced.
- Keep raw activity journal IDs/paths, prompts, reasoning, tool arguments and
  results out of browser-facing activity data and desktop diagnostics.
  Existing intentional Library document access remains within its established
  validated routes; this wrapper adds no broader content access.
- Observation remains read-only. The existing explicit Library settings writes
  and optional Windows startup registration are distinct, bounded mutations;
  neither permits changes to Copilot configuration or journals.

Electron versions and packaging dependencies must be selected and pinned during
implementation using supported releases. The bundled Node runtime must satisfy
the existing application's requirements.

## Installer and build packaging

Use one maintained Electron packaging tool; select it before implementation.
Do not introduce multiple installer systems for v1.

The package must include:

- Electron runtime, desktop entry point, existing application modules and assets.
- Runtime dependencies needed by the server and all locally served vendor files.
- Existing Node worker entry points and generated browser worker.
- Production `LibraryHelper.exe`, outside the Electron ASAR archive at a
  controlled executable location. Adapt the existing module-relative lookup as
  necessary while preserving source-mode behavior.
- Application icon and required Electron/Chromium/dependency license notices.

Build the Library artifacts before packaging using the existing scripts:

```powershell
npm run build:library-helper
npm run build:library-renderer
node scripts/build-library-renderer.mjs --check
```

The helper is built on the build machine, not at installation or runtime. Fail a
Library-enabled package build if required artifacts or licenses are missing.
Do not ship synthetic test helpers, real journals, personal Library documents,
settings, credentials, or the developer's local state.

Verify Node worker loading, native helper execution, static dependency paths and
generated browser-worker URLs from the packaged installation. Source-mode success
does not establish packaged compatibility.

For personal use, an unsigned build may be acceptable with an explicit warning
that Windows can show publisher/SmartScreen warnings. Never instruct users to
disable Windows protections. Wider distribution requires a separate signing
decision; credentials and service purchases are outside this specification.
Signing does not guarantee the absence of reputation warnings.

## Failure handling and recovery

| Condition | Expected proposed behavior |
| --- | --- |
| Second desktop launch | Focus/restore the first instance; no second server or helper. |
| Port already occupied, including CLI mode | Show a bounded startup error and exit cleanly. Never kill the listener or load its content. |
| Server startup or UI load fails | Show an actionable, non-sensitive error; clean up owned resources. Do not leave an invisible process. |
| Missing/incompatible Library helper | Preserve the existing Library-unavailable behavior; ordinary activity remains usable. A release package missing its required helper fails packaging checks. |
| Unsupported Library filesystem or settings ACL | Preserve the current fail-closed warning; do not repair permissions or bypass validation automatically. |
| Startup registration fails or is disabled by Windows | Show the actual state and an actionable error/status; never claim enabled from intent alone. |
| App closed while work is active | Stop this app's observation and owned processes only; do not terminate or modify Copilot sessions. |
| Upgrade/uninstall | Do not leave stale startup launchers. Preserve user Library data/settings unless deletion is separately requested. |

A renderer failure must not cause an uncontrolled restart loop or leave hidden
background observation. Exact recovery UI can be chosen during implementation,
provided failures remain visible and shutdown remains available.

## Proposed acceptance criteria

| ID | Observable acceptance check |
| --- | --- |
| AC-01 | On a supported Windows x64 test account without separately installed Node.js/npm, the installed shortcut opens the existing UI without a console or separate browser. |
| AC-02 | Synthetic live activity reaches the desktop UI with unchanged bounded projections, baseline behavior and unknown-coverage semantics. Existing workspace and Library flows remain usable. |
| AC-03 | A second launch restores/focuses the existing window; only one desktop-owned server exists. |
| AC-04 | Closing the window terminates the owned server/workers/helper. The port is released and a subsequent launch works. Partial-start and UI-load failures also release resources. |
| AC-05 | Startup is initially off. Enabling launches the visible app after a real sign-out/sign-in; disabling prevents that launch. A disabled/failed registration is not displayed as enabled. |
| AC-06 | With an unrelated synthetic listener on the fixed port, startup reports a conflict without loading its content, changing the port, or terminating that listener. |
| AC-07 | The packaged Library reads synthetic fixtures and applies existing path/ACL protections; generated rendering and metadata workers load outside the checkout. No runtime compilation/download occurs. |
| AC-08 | Renderer Node access and unapproved IPC are unavailable; external navigation, popups and unexpected permissions are refused. Existing HTTP security tests continue to pass without relaxed protections. |
| AC-09 | Installed launch works from an arbitrary working directory and a path containing spaces. A clean test-user install requires no build tools or administrator privileges. |
| AC-10 | Upgrade preserves the chosen startup state and existing settings; uninstall removes only app-owned startup registration and binaries, not Copilot journals or Library documents. |

### Required implementation evidence

These checks are future work, not results of writing this specification:

- Existing `npm test` and `npm run check:publication` pass for the candidate.
- Focused automated tests cover lifecycle success/failure, single-instance
  behavior, port conflicts, packaged resource resolution and startup-state errors.
  Use synthetic fixtures and controlled processes.
- Record installer/installed-app checks against the same built artifact, with
  Windows, Electron and bundled Node versions. Mocked Electron tests do not
  replace installed-app, real sign-in, upgrade or uninstall observations.
- Perform security checks with synthetic Library content, including hostile
  links/navigation. Do not use real user journals or screenshots as fixtures.
- Update the main README with actual desktop build/install/quit/startup behavior
  and signing limitations once implemented, retaining CLI instructions.

## Deferred scope

Not included in proposed v1: tray/background mode, silent startup, Windows
service, auto-updates, Microsoft Store/MSIX publication, multi-platform packages,
ARM64 builds, new renderer features, activity history persistence, remote access,
or replacement of the existing Library safety boundary.

## Decisions before implementation

1. Confirm the proposed v1 behavior and that Electron is the chosen framework.
2. Confirm supported Windows versions and x64-only scope against the selected
   supported Electron release; no Windows support range is asserted here.
3. Select the packaging tool and per-user installer format, including stable
   startup-launcher, upgrade and uninstall semantics.
4. Confirm personal unsigned distribution versus a signed distribution and its
   separately authorized signing setup.

These are not blockers to this draft. They must not be silently treated as
approved requirements by an implementation agent.

## External design references

Previously consulted Electron documentation; recheck against the selected
version during implementation:

- [Security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [App lifecycle, single-instance and login-item APIs](https://www.electronjs.org/docs/latest/api/app)
- [Code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
