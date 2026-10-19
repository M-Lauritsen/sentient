# Shared navigation menu

## Purpose and structure
Replace the two top-HUD launch buttons with one labelled Menu button at the lower right. Keep activity observation status independent of navigation.

| Entry | Action |
| --- | --- |
| Library | Open the existing read-only Library dialog |
| Appearance | Open the nonmodal visual-settings drawer |
| Workspace | Open module catalogue, profiles and Edit layout controls |
| Help & legend | Explain scene gestures, category meanings and observation limits |

- The launcher opens upward on desktop and remains above safe-area/browser edges. Reposition branding into a compact shared corner arrangement; do not overlap the timeline or workspace.
- Source connection, coverage/unknown warnings and core running/waiting counts remain directly visible. They cannot be removed as optional modules.
- Module actions remain on their modules; timeline expansion and session details do not require navigation through Menu.
- Workspace is an entry to a panel, not a deeply nested menu. Profile selection and module forms belong there, not inside menu items.
- Library remains a separate sensitive viewer. Opening it must not fetch its documents into workspace models or disable SSE.

## Interaction and accessibility
- Use a real labelled button, aria-haspopup=menu, aria-expanded and aria-controls, with WAI-ARIA menu-button keyboard behaviour.
- Enter/Space opens and focuses the first item. Arrow Up/Down traverse items; Home/End select endpoints; Escape closes and restores focus.
- Tab closes the menu and continues normal focus traversal. Clicking outside dismisses without stealing focus from the clicked control.
- Selecting an entry closes the menu, then moves focus into the destination; close returns to the launcher unless a more specific surviving invoker exists.
- If destination content is already open, focus it rather than constructing a duplicate panel.
- Native modal destinations retain focus trapping and Escape behaviour. The Appearance drawer is nonmodal: the scene and other controls remain reachable.
- Library opened over Appearance preserves the visual draft and returns focus to an available launcher/drawer control on close.
- Never use an icon-only launcher without an accessible label. Focus must be visible; text/controls target WCAG 2.2 AA, including 24x24 CSS-pixel minimum targets unless an applicable exception is documented.

## States and acceptance
| State/action | Required result |
| --- | --- |
| Closed/open | Correct expanded state and no invisible focusable menu items |
| Keyboard-only navigation | Every destination opens; no trapped/lost focus |
| Library unavailable/error | Existing explanatory Library state; menu and activity still operate |
| Appearance draft exists | Opening/closing menu or Library does not discard it |
| Narrow viewport / zoom | Launcher and all items remain within viewport; long content scrolls |
| Source disconnected | Persistent source warning remains visible with menu open or closed |

## Dependencies, non-goals and rollback
Integrate against the workspace entry points from ticket 02; route Appearance to its existing controller until ticket 05 lands.
No command palette, global shortcut, external navigation, server administration or configuration writes are introduced.
Rollback restores the old two launch buttons and wiring; keep destination controllers and browser preferences intact.
Reference: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
