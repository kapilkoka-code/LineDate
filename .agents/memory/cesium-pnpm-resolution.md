---
name: Cesium pnpm resolution
description: Prevents LINE's Vite development server from breaking on incompatible Cesium internal package patches.
---

Keep Cesium's internal engine and widgets packages pinned to the exact versions recorded in the workspace override when updating Cesium. Do not force current Cesium releases onto WebGL 1; preflight WebGL 2 and use the app fallback when it is unavailable.

**Why:** Cesium's caret ranges can resolve a newer internal patch that does not export the symbols expected by the installed Cesium release. Vite's development optimizer then crashes even though the production build may pass. pnpm can also leave stale physical symlinks after changing these versions. Current shaders can use GLSL qualifiers that fail when an otherwise WebGL 2-capable browser is deliberately downgraded to WebGL 1.

**How to apply:** After any Cesium dependency update, confirm Cesium's nested `@cesium/engine` and `@cesium/widgets` symlinks resolve to the overridden versions. If the lockfile is correct but symlinks are stale, force a clean pnpm relink before restarting the web workflow. Keep `requestWebgl1` disabled and treat a failed WebGL 2 probe as a normal fallback condition.