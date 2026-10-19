# Future executable module system - deferred design

## Scope and delivery boundary
The user requested a separate future plugin-system specification alongside configured views now. This document is a requirements and decision outline, not an approved executable-plugin architecture.
No plugin loader, script evaluator, manifest installation, network permission, filesystem API or executable delivery ticket is authorized.

## Intended capability
Let a user install a code-authored module that declares its configuration and renders a workspace panel. Installation and execution must be explicit and distinguishable from creating a safe configured view.
Plugins must not acquire access merely because they share the application's origin, DOM, local storage or Node server.

## Options and tradeoffs
| Option | Benefit | Risk/cost |
| --- | --- | --- |
| Trusted bundled modules only | Smallest boundary; same reviewed release process | Not a general user plugin ecosystem |
| Sandboxed iframe + restricted messaging | Separates rendering from host DOM and origin storage when correctly isolated | CSP, origin/network restrictions, message validation, accessibility and resource controls need real proof |
| Worker logic + host-rendered declarative UI | Restricts DOM authority and standardizes accessibility | Not a complete sandbox by itself; network/resource controls and expressive UI contract remain unresolved |
| Same-origin arbitrary ES modules | Easy integration | Executes with host authority; not an acceptable isolation story for untrusted plugins |

Recommendation for future investigation: compare sandboxed iframe and declarative worker designs using synthetic data only. Do not select one without threat modelling and demonstrable network/storage isolation.

## Required contract before implementation
- Versioned manifest: stable identifier/version, compatible host API, entry assets, requested capabilities, configuration schema and accessible display metadata.
- Only explicitly approved bounded data projections. Start with aggregate category counts/coverage; any session-handle access needs its own necessity and unlinkability decision.
- Never grant raw journal access, prompts/reasoning, tool arguments/results, filesystem paths, Library content, process execution or server configuration.
- Installation must show origin, capabilities and execution warning. Unknown or expanded permissions require new consent; no automatic remote updates.
- No CDN/remote executable dependency in host delivery. Plugin packaging, verification, local asset serving and removal need a separate reviewed mechanism.
- Host validates all inbound/outbound messages, sizes, rates and versions. Never treat plugin content as HTML or commands.
- Define create/update/resize/suspend/dispose, error boundary, crash indication and per-plugin resource budgets; document limitations of browser isolation.
- Disabling/uninstalling preserves host observation and other modules. No plugin gets ownership of the shared activity connection.
- Preferences may contain plugin configuration only after explicit schema review; no observed-data persistence or telemetry by default.
- Loading, permission denied, incompatible version, crash, timeout and disabled states require clear recovery; never report success after a denied load.

## Decisions deliberately blocking executable work
| Decision | Options | Current disposition |
| --- | --- | --- |
| Trust model | Bundled trusted / user-trusted / untrusted third-party | Open; user approval required |
| Isolation | Sandboxed iframe / worker-declarative / trusted-only | Deferred to synthetic spike + security review |
| Permitted data | Aggregate-only / additional bounded projections | Aggregate-only starting proposal, not a granted capability |
| Installation/update authority | Local packages / curated registry / other distribution | Open; no registry or network design selected |
| API compatibility and resource budgets | Version policy and hard limits | Must be specified and measured in future work |

## Future acceptance and verification gates
An approved threat model and isolation design must precede runnable implementation tickets. Use malicious synthetic packages to demonstrate blocked host-DOM/storage/filesystem access, blocked unauthorized network access, rejected malformed messages, permission revocation and host survival after plugin failure.
WCAG 2.2 AA and keyboard/non-drag workspace integration remain required. An explicit security-review task is mandatory for executable implementation.
There is no meaningful runtime verify command yet: no plugin runtime exists. Future investigation must establish exact commands and evidence; current Node UI tests cannot prove plugin sandboxing.
Rollback requirement: disable plugin discovery/execution without deleting journals, Library registrations, workspace profiles or visual presets.
