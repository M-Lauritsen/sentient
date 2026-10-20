# Appearance settings persistence

- **Question:** Why must appearance edits replace `visual-settings.mjs`, and could the app persist them instead?
- **Decision:** Choose the simplest persistence model for user-edited appearance.
- **Current behavior:** `visual-settings.mjs` is a static ES module served by an allowlist. The UI previews edits; personal presets go to browser `localStorage`; export downloads a replacement module. The app does not auto-load a saved active personal preset.
- **Option A — Keep export:** No runtime persistence changes; user explicitly replaces the source module. Simple for repository-maintained/developer config, awkward for ordinary users.
- **Option B — Save active appearance to `localStorage` (recommended):** No new file, native code, or server write endpoint; auto-load and validate a saved snapshot on this browser origin. Clearing site data removes it; other browsers do not share it.
- **Option C — Node-owned settings JSON:** Persists beyond browser storage and can serve multiple clients; requires a validated local write endpoint, atomic persistence, and conflict/error handling.
- **Recommendation:** Use B for user preferences; retain export for repository-authored settings/sharing. `visual-settings.mjs` remains defaults, not the mutable user store.
- **Why not silently overwrite the module:** A browser page has no arbitrary filesystem write permission. The File System API requires user-granted file/directory handles; the local Node server could write, but this app has no such appearance-settings endpoint.
- **Evidence:** `visual-settings-ui.mjs`, `visual-config.mjs`, `server.mjs`, `README.md`; https://developer.mozilla.org/en-US/docs/Web/API/File_System_API ; https://nodejs.org/api/fs.html
- **Confidence:** High.
- **Open questions:** Should saved appearance be per browser profile (B) or shared across browsers via the local server (C)?
- **Next lane:** Standard, if implementing the per-browser behavior; planned if requiring cross-client/server-managed settings.
