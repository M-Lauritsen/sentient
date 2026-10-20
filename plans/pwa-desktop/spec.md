# Browser-managed PWA + Windows companion launcher
Gate A: PASS — checkpoint ① approved; specifications only; checkpoint ② pending.
Issue: none · Lane: planned · Branch: existing user-owned feature/windows-desktop-electron-03 (no branch operations).
Outcome: Installable Edge/Chrome PWA and checkout-based Windows/Node.js 22+ launcher, not a native window.
Acceptance: launcher cold-starts an owned loopback server before opening the app; delayed best-effort stop after all participating windows close; automated and real-browser evidence required.
Blast radius: local server, browser assets/client lifecycle, Windows launcher, tests/docs; no Prod deployment.
Contract/schema/content-model impact: additive manifest and owned-mode lifecycle protocol; volatile leases only; no DB/CMS migration.
Security review: required for lifecycle capability, same-origin guards, ownership, privacy and bounded resources; no external services.
Rollback: remove launcher/owned mode and manifest integration; retain ordinary npm start; browser uninstall is separate.
Assumptions: existing checkout/dependencies and Node.js 22+; supported Windows Edge/Chrome; no guaranteed closure detection.
DoD: TEST + automated lifecycle/security + manual browser/lifecycle acceptance; BUILD/LINT/TYPECHECK N/A (no applicable general scripts); evidence pending.
Major: yes (launcher/server lifecycle and browser installation/client integration cross areas).
## Approved scope (checkpoint ①, verbatim)
"specifications only: define an installable Edge/Chrome PWA plus a Windows launcher using this checkout and Node.js 22+, with best-effort delayed shutdown after all participating app windows close. Preserve loopback/privacy restrictions; never stop an independently started server; no offline caching of activity or Library data. The specs will distinguish the launcher shortcut (starts the server) from the browser-installed shortcut (cannot), define suspension/reconnection risks and lifecycle safeguards, and include runnable implementation tickets plus automated and real-browser acceptance checks. No implementation, commits, or pushes."
## Design note
- Manifest: /manifest.webmanifest; stable id/start_url/scope "/", name "SENTIENT OS", short_name "SENTIENT", display "standalone", local 192/512 PNG icons; explicit STATIC_FILES/MIME entries.
- Launcher contract: node desktop/launch.mjs --browser edge|chrome; Windows shortcut supplies the selected browser and checkout; no-argument default Edge; no silent browser/profile substitution.
- Browser-installed shortcut opens the fixed origin only; launcher shortcut bootstraps Node. Actual installed-app activation is investigation I1, never an assumed universal CLI switch.
- Ready/failure: private child IPC identity plus bounded HTTP readiness before browser opening; typed failures and owned-only cleanup; occupied port always fails closed; npm start unchanged.
- Owned-mode HTTP: GET /api/app-lifecycle/ready, GET /api/app-lifecycle/session, POST /api/app-lifecycle/leases; JSON/errors, guards and bounds in decisions D8–D10; no HTTP shutdown operation.
- Leases: per-window memory ID, boot-scoped token; 15s heartbeat, 90s TTL, 30s empty grace, 120s first-window grace; aggregate all registered same-origin windows/tabs, including hidden ones.
- Data/CMS: bounded volatile leases/instance identity only; no content model change, activity/Library persistence, service worker, Cache API or offline shell.
- UI: loading until fresh validated snapshot; empty is not verified idle; gap/return-from-suspension is unknown immediately, stale state never live; backend-down cold shortcut may show browser error.
- Security: IPv4 127.0.0.1:43187 only; strict Host/origin/fetch checks, memory-only lifecycle token, bounded JSON/timers; no URLs/logs/activity carry secrets; no process-name/foreign-listener termination.
- Rollback: stop only the owned child, remove additive integration, use npm start/Ctrl+C; installed shortcuts remain until browser uninstall and cannot start Node.
## Delivery and acceptance
- 01 (parallel: yes): installability/assets + bounded real Edge/Chrome activation investigation; 02 (after 01 merged): launcher/owned-mode server with synthetic lease clients; 03 (after 01/02 merged): browser lease client, gap recovery, documentation and full browser matrix.
- Each ticket has Lead owner, its own DoD rows, exact node:test commands, synthetic fixtures and separate pending automated/manual evidence; branches are suggestions only.
- Run scoped tests and npm test at each implementation ticket; current results must be collected, not inferred from the historical project-profile baseline.
- Real Edge AND Chrome: install, supported cold launcher activation, installed-shortcut limitation, last-window delay, multi-window aggregation, suspension/reconnection, duplicate starts/foreign listener, launch failures and cleanup.
## Decisions, risks and prerequisites
- Confirmed choices and detailed contracts: [decisions.md](decisions.md); no implementation authorized until checkpoint ② approval.
- I1 is the only investigation prerequisite: bounded validation of browser/profile/app activation and shortcut quoting; ticket 02 blocks on unsupported mechanics, with evidence rather than guessed CLI.
- Suspension/crash/timer throttling can expire an open window's lease or delay shutdown; keep the true PWA and disclose this accepted limitation, not a native-window workaround.
- Excluded: Electron, installer/bundled runtime, auto-login startup, telemetry/CDN, offline data caching, packaging dependency, broad redesign, ignore/publication changes.
