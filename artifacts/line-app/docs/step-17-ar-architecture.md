# Step 17 — World-anchored AR architecture

Date reviewed: 2026-09-05

## Decision: partial web support

LINE can provide genuine **session-local world tracking** as a progressive enhancement on supported Android Chrome devices. It cannot provide the same capability in ordinary iOS Safari, and it cannot promise persistent geospatial relocalization from the current privacy-safe nearby response.

The supported WebXR path fixes the twin lights in a WebXR reference space. Device translation and rotation then come from the AR camera pose, so the lights do not follow the screen. This is true world tracking for the lifetime of the immersive session, not a CSS, compass, or camera simulation.

The existing Step 15–16 experience remains the primary cross-platform path.

## Current stack

- React, TypeScript, and Vite delivered as a browser application.
- Rear camera from `getUserMedia`, owned by the FIND screen with cancellation-safe stream lifecycle.
- Earth-referenced heading from iOS compass data or explicitly absolute device orientation.
- Browser geolocation with accuracy and age diagnostics.
- Privacy-safe nearby records containing server-computed distance, a 15-degree bearing sector, and server-computed unlock state.
- DOM/CSS twin-light rendering over camera video.
- Cesium map discovery with a non-WebGL fallback.
- No existing WebXR dependency, native shell, ARKit bridge, or ARCore SDK.

## Platform findings

### Android Chrome

On an ARCore-supported Android device, Chrome can expose `immersive-ar` WebXR sessions. Google documents shipped WebXR support for hit testing, anchors, Depth API, and lighting estimation, although availability still depends on the device, browser, permission state, and secure context.

LINE uses direct WebXR and WebGL rather than adding a large AR framework. The initial local anchor is derived from the already-available coarse bearing and server distance. No exact letter coordinates are added to the API.

### iOS Safari

Ordinary iOS Safari does not provide supported `immersive-ar` WebXR sessions. Safari on visionOS supports immersive WebXR features, but this does not provide an iPhone ARKit bridge for the LINE web app.

LINE must not label camera + compass rendering as true AR on iPhone. iPhone continues through sensor spatial mode, camera-only mode, or map fallback.

### Native/hybrid requirement

A future cross-platform implementation with persistent geospatial relocalization, VPS, reliable plane/depth behavior, and equivalent iPhone support requires a native or hybrid shell using ARKit and ARCore. ARCore Geospatial anchors and comparable native platform APIs are outside ordinary cross-platform browser support.

## Capability hierarchy

1. `WORLD_AR_SUPPORTED`
   - `navigator.xr` exists.
   - `immersive-ar` is reported as supported.
   - A high-confidence earth-referenced heading, current location, and at least one server-provided signal are available.
   - An immersive session can be started from a user gesture.
2. `SENSOR_SPATIAL_MODE`
   - Existing camera plus Step 15 orientation/Step 16 spatial light.
3. `CAMERA_ONLY`
   - Camera is available, but absolute direction is unavailable; touch look remains available.
4. `MAP_FALLBACK`
   - Camera is unavailable or denied; use existing map discovery.

Session request failure, tracking loss, backgrounding, or user exit returns to the best existing lower mode. User-facing copy describes calibration or directional finding rather than browser APIs.

## Anchor model

- WebXR provides the camera pose and a stable local reference space.
- On the first non-emulated viewer pose, each signal is projected from server distance and coarse bearing into that local reference space.
- The current verified compass heading is calibrated against the first XR viewer yaw, aligning geographic bearing with the real XR coordinate frame.
- Static world-space light geometry remains fixed while the viewer pose changes.
- Primary, secondary, and tertiary lights retain the existing visual hierarchy.
- The anchor is valid only for the current immersive session. It is rebuilt after a new session.

This model is intentionally approximate because the server bearing is quantized. It provides stable physical presence without claiming centimeter accuracy or persistent global placement.

## Privacy and authorization

- Nearby responses continue to omit letter latitude and longitude.
- No Step 17 API or database change is required.
- World geometry uses only opaque letter ID, server distance, 15-degree bearing sector, prominence, and server unlock state.
- Visual position never authorizes opening or replying.
- The existing server continues to recompute proximity for protected routes.
- WebXR camera poses remain in memory for the active session and are not uploaded or stored.

The pre-existing web trust limitation remains: browser-reported GPS can be spoofed by a modified client. Step 17 does not weaken or attempt to disguise that limitation.

## Environmental integration

The first web path does not fake occlusion, planes, or depth. Although some Android Chrome/ARCore combinations expose these optional WebXR features, using them reliably requires device validation and a separate rendering path. The initial implementation uses local-floor when available and transparent additive light geometry only.

## Sources

- Google, “WebXR compared to ARCore”: https://developers.google.com/ar/develop/webxr/arcore-comparison
- Google, “WebXR”: https://developers.google.com/ar/develop/webxr
- MDN, `XRSystem.isSessionSupported()`: https://developer.mozilla.org/en-US/docs/Web/API/XRSystem/isSessionSupported
- MDN, “Spatial tracking in WebXR”: https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Spatial_tracking
- Apple Developer Forums, WebXR immersive AR support statement: https://developer.apple.com/forums/thread/756850