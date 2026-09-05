---
name: Cesium build and pnpm resolution
description: Prevents LINE's Vite development and production builds from breaking on Cesium package or static-runtime path mismatches.
---

Keep Cesium's internal engine and widgets packages pinned to the exact versions recorded in the workspace override when updating Cesium. Keep Vite's build output relative to the configured app root when using `vite-plugin-cesium`. Do not force current Cesium releases onto WebGL 1; preflight WebGL 2 and use the app fallback when it is unavailable.

**Why:** Cesium's caret ranges can resolve a newer internal patch that does not export the symbols expected by the installed Cesium release. Vite's development optimizer then crashes even though the production build may pass. pnpm can also leave stale physical symlinks after changing these versions. The Cesium Vite plugin joins the app root and output directory while copying its production runtime; an absolute output path is duplicated inside the artifact, so the shell publishes while Cesium scripts, workers, widgets, and assets are missing. Current shaders can use GLSL qualifiers that fail when an otherwise WebGL 2-capable browser is deliberately downgraded to WebGL 1.

**How to apply:** After any Cesium dependency update, confirm Cesium's nested `@cesium/engine` and `@cesium/widgets` symlinks resolve to the overridden versions. If the lockfile is correct but symlinks are stale, force a clean pnpm relink before restarting the web workflow. After every production build, verify the publish root contains Cesium.js plus Workers, Widgets, Assets, and ThirdParty at the URLs injected into index.html. Keep `requestWebgl1` disabled and treat a failed WebGL 2 probe as a normal fallback condition.