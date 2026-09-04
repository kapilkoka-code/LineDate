# Step 15 real-device sensor validation

Use a disposable test account and test letters. Never use sensor calculations to authorize access: the API-provided distance and `isUnlocked` values remain authoritative.

## Before testing

1. Use HTTPS and confirm the development sensor panel is absent from a production build.
2. Place one test letter at a surveyed location.
3. Confirm FIND has permission to use location and the rear camera.
4. Record the phone model, operating-system version, browser version, weather, and whether the test is indoors or outdoors.

## iPhone — Safari

- Tap **START FINDING** and grant camera, location, motion, and orientation permissions from that gesture.
- Confirm no later surprise motion prompt appears.
- Deny motion once and verify horizontal drag remains usable.
- Confirm the rear camera starts, pauses when Safari is backgrounded or the phone is locked, and resumes after returning.
- Rotate between portrait and both landscape orientations; the LINE must preserve the physical bearing rather than jumping randomly.
- Walk around the test location and confirm distance updates without continuous network activity.
- Confirm the near and unlock haptics are subtle.
- Repeat with Low Power Mode and reduced motion enabled.

## Android — Chrome

- Tap **START FINDING** and grant camera and location permissions.
- Confirm orientation begins without an extra prompt where the browser exposes it.
- Disable orientation access or test a device without absolute orientation and verify horizontal drag remains usable.
- Confirm camera and sensor processing pause in the background and resume in the foreground.
- Rotate between portrait and both landscape orientations without losing the physical bearing.
- Confirm distance refresh and haptics behave as expected.
- Repeat with Battery Saver and reduced motion enabled.

## Direction and distance matrix

At approximately 50m, 30m, 20m, 10m, and 5m from the test letter:

1. Face north, east, south, and west.
2. Verify the two beams move toward the part of the camera view containing the letter.
3. Slowly rotate through 360°. The LINE should cross the screen smoothly and return to its original position.
4. Pause at each cardinal direction and check for jitter, snapping, oscillation, or excessive delay.
5. Repeat after rotating the screen orientation.
6. If GPS accuracy is poor relative to distance, verify FIND softens the response and shows “Finding a clearer signal…” instead of implying exact direction.
7. If compass confidence is poor, verify the calibration message appears briefly and disappears after readings stabilize.

## Development simulation

In development test mode, cover every combination of:

- Distance: 100m, 50m, 20m, 10m, 5m
- Letter bearing: 0°, 90°, 180°, 270°
- User heading: 0°, 90°, 180°, 270°

Also verify the wrap-around presets:

- User 350°, letter 10° = +20°
- User 10°, letter 350° = -20°

For each case, confirm the displayed bearing difference is the shortest signed angle and the LINE appears on the correct side. Simulated 5m must never create authorization or show **OPEN LETTER** unless the selected real server record already has `isUnlocked: true`.

## Degradation and privacy

- Deny camera: FIND offers map discovery.
- Deny location: FIND explains that location is needed without exposing technical GPS details.
- Deny orientation: touch drag remains available.
- Disable the network after loading: existing camera presentation remains stable and refresh reports interruption.
- Confirm nearby responses expose only privacy-safe bearing, server distance, unlock state, and existing public letter metadata—never exact letter coordinates, writer identity, or private profile data.