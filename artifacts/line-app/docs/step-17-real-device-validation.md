# Step 17 — Real-device world view validation

Desktop simulation cannot validate world tracking. Complete this procedure on physical devices before describing the WebXR path as validated for a particular device/browser combination.

## Test data and safety

- Use an ordinary server-backed test LINE at a known outdoor location.
- Do not add persistent production test letters.
- Confirm the nearby response does not contain latitude or longitude.
- Record browser, browser version, OS version, device model, AR services version, permission state, and whether `WORLD_AR_SUPPORTED` was detected.
- Never use the rendered light position as proof of unlock. Confirm every protected open/reply request is still accepted or rejected by the server.

## iPhone

Test current iOS Safari first, then any other installed iOS browser.

Expected web behavior:

- `immersive-ar` is not reported as supported.
- No World View button is shown.
- FIND continues with camera + verified compass heading.
- If heading permission is denied or unavailable, touch look remains available.
- If camera permission is denied, map discovery remains available.

Checks:

1. Grant camera, location, and motion/orientation permissions.
2. Find a LINE with sensor spatial mode.
3. Rotate 90°, 180°, and through 360°.
4. Raise and lower the phone.
5. Rotate screen orientation.
6. Lock/unlock, then background/foreground Safari.
7. Confirm camera and orientation resources stop while hidden and recover after return.
8. Approach 10m and confirm only the real server response enables opening.
9. Use development distance simulation at 5m and confirm it cannot unlock.

Record the limitation plainly: this is Step 15–16 directional spatial rendering, not true world-anchored AR.

## Android Chrome — unsupported device or configuration

Expected behavior matches the iPhone fallback hierarchy:

1. No World View button when `immersive-ar` is unsupported.
2. Sensor spatial mode remains usable.
3. Camera-only touch mode remains usable if absolute heading is unavailable.
4. Map discovery remains reachable after camera denial.
5. No browser/API terminology is shown to the user.

## Android Chrome — ARCore-supported device

Prerequisites:

- Current Chrome.
- Current Google Play Services for AR.
- HTTPS origin.
- Rear camera, location, and motion permissions.
- A nearby server signal and a verified absolute heading.

### Entry and identity

1. Start FIND normally.
2. Confirm Step 16 directional lights are working before World View appears.
3. Tap **Enter world view** from a user gesture.
4. Confirm the camera stream transfers cleanly; there must not be two simultaneous camera owners.
5. Confirm two coral light columns appear for the primary LINE.
6. Confirm secondary and tertiary anchors remain quieter than the primary.
7. Confirm there are no arrows, pins, waypoints, floating icons, or conventional compass markers.

### Physical stability

For every movement, observe a fixed object near the apparent light origin and record any drift or jump:

1. Stand still for 30 seconds.
2. Rotate 90°.
3. Rotate 180°.
4. Turn through 360° in both directions.
5. Walk sideways 3–5m.
6. Walk toward the light.
7. Walk away from the light.
8. Walk past the apparent light position.
9. Raise and lower the phone.
10. Change portrait/landscape orientation if the browser permits it during the session.

Pass condition: the lights remain fixed in the physical reference space while the camera pose changes. Small ARCore tracking drift may occur; obvious screen-following, compass-only rotation, or repeated jumps fail the world-view path.

### Loss and recovery

1. Cover the camera or face a featureless surface long enough to lose tracking.
2. Confirm the UI shows “Calibrating surroundings…”.
3. If tracking does not recover promptly, confirm the immersive session ends and FIND returns to “Using directional finding…”.
4. Re-enter World View and confirm a fresh local anchor is created.
5. Lock/unlock the device.
6. Background/foreground Chrome.
7. Confirm the WebXR session ends safely and the ordinary camera is reacquired only after the immersive owner releases it.
8. Use the browser/system exit action and confirm the same recovery.

### Distance and authorization

1. Begin outside 20m.
2. Walk toward 10m.
3. Exit World View and refresh nearby data.
4. Confirm the server remains authoritative for `isUnlocked`.
5. Approach 5m and repeat.
6. Spoof only the visual development distance to 5m and confirm it cannot unlock.
7. Confirm opening/replying still requires a server-authorized response.

### Performance and accessibility

1. Observe the development FPS diagnostic for at least 60 seconds.
2. Check thermal behavior and visible frame drops while rotating and walking.
3. Confirm at most three LINE anchors render.
4. Enable reduced motion. World View should remain physically stable and contain no decorative particle animation.
5. Verify exit controls, safe areas, and readable calibration/status text.

## Platform limitations to record

- World View is session-local; leaving the immersive session creates a new local anchor next time.
- The 15-degree server bearing intentionally limits directional precision.
- The web path does not currently use fake occlusion, plane geometry, or depth masking.
- Availability of optional WebXR anchors, lighting, and depth features varies by Chrome, ARCore, and device.
- Persistent geospatial/VPS relocalization and equivalent iPhone support require a future native/hybrid ARKit + ARCore implementation.

## iPad 3D map validation record

- Date: 2026-09-05
- Device: iPad Pro 11-inch (2nd generation)
- OS: iPadOS 26.6
- Browser: Safari (bundled with iPadOS 26.6)
- Result: PASS
- The authenticated HOME screen opened without a Vite error overlay or shader/reserved-word error.
- WebGL 2 was available and the Cesium globe rendered cleanly.
- The globe remained clean through HOME → FIND → HOME.