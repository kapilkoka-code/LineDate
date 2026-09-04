---
name: Cesium pnpm resolution
description: Prevents LINE's Vite development server from breaking on incompatible Cesium internal package patches.
---

Keep Cesium's internal engine and widgets packages pinned to the exact versions recorded in the workspace override when updating Cesium.

**Why:** Cesium's caret ranges can resolve a newer internal patch that does not export the symbols expected by the installed Cesium release. Vite's development optimizer then crashes even though the production build may pass. pnpm can also leave stale physical symlinks after changing these versions.

**How to apply:** After any Cesium dependency update, confirm Cesium's nested `@cesium/engine` and `@cesium/widgets` symlinks resolve to the overridden versions. If the lockfile is correct but symlinks are stale, force a clean pnpm relink before restarting the web workflow.