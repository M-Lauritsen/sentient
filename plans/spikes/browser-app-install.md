# Browser app installation
Question: Can SENTIENT offer a browser install icon and desktop launch?
Decision: Browser-installed app versus a native desktop wrapper.
Facts: The app runs at http://127.0.0.1:43187/ using a local Node server.
Facts: No web manifest or service-worker registration was found.
Option: PWA manifest and icons; small change, standalone window and OS shortcut.
Limitation: Installing the UI does not install or start the Node server.
Option: Desktop wrapper/launcher; more packaging work, can own server startup.
Recommendation: Use a PWA for browser installation if separate server startup is acceptable.
Confidence: High; browser promotion timing and UI remain browser-controlled.
Open question: Must the desktop shortcut also start the local backend?
Next lane: Standard for manifest/icons only; planned for native packaging and startup.
Source: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
