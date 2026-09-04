# Step 18 spatial audio validation

Step 18 uses bearing-based Web Audio stereo positioning. It does not claim a world-locked acoustic source in WebXR. The visual LINE remains authoritative, and all proximity and unlock authorization remains server-owned.

Record the device model, OS version, browser version, output route, and whether headphones were used for every run.

## Shared safety checks

1. Start FIND with audio on, then repeat with audio off.
2. Deny or block audio/autoplay if the browser exposes that control. FIND must remain fully usable with no repeated prompt or blocking error.
3. Confirm no sound is produced before `START FINDING`.
4. Confirm no sound when there are no server-returned signals.
5. Confirm opening a letter, opening the reply composer, leaving FIND, locking the device, changing tabs, or backgrounding the browser suspends audio immediately.
6. Return to FIND. Audio may resume quietly; it must not create overlapping voices or a second audible soundscape.
7. Repeat with reduced motion enabled. Visual FIND must remain usable and audio changes must stay gradual.
8. Keep a server-locked letter outside 10m. Audio intensity must never expose its text, writer, exact coordinates, or make it openable.

## Direction matrix

Use a real server signal and verified absolute heading where available. Test with headphones first, then the device speaker:

- Directly ahead: centered.
- 45° left/right: gently weighted to the corresponding side.
- 90° left/right: clearly side-weighted without a directional ping.
- Directly behind: quieter and darker, not falsely precise.
- Cross north from 359° to 0°: no pan jump to the opposite side.

Repeat while confidence is high, medium, low, and unavailable:

- High may use the full stereo field.
- Medium must be noticeably softer.
- Low must remain mostly atmospheric.
- Unavailable must be centered.

## Distance and hierarchy

1. Walk from farther than 50m through approximately 30m, 20m, 15m, and the real server unlock radius.
2. Confirm loudness and definition change smoothly with no abrupt step.
3. With three visible signals, confirm the primary dominates, secondary remains faint, and tertiary is barely atmospheric.
4. Confirm the 30m/15m approach feedback occurs at most once when crossing inward, not on every refresh.
5. At a real server-authorized unlock, confirm one restrained bloom and the existing single haptic. It must not resemble a success chime.
6. Walk outward and inward again. Confirm loops do not duplicate and authorization still follows the server response only.

## Android Chrome with WebXR/ARCore

1. Complete the Step 17 world-view checks first.
2. Enter world view while FIND audio is running.
3. Audio may continue only as a soft bearing-based layer. Do not assess or describe it as world-locked.
4. Rotate and walk around the anchored visual LINE. The visual anchor must remain authoritative.
5. Trigger tracking loss and background/foreground recovery. Confirm audio suspends during setup/loss and returns without duplication.

## iOS Safari

1. Grant motion/orientation permission from `START FINDING`.
2. Verify high-confidence absolute compass direction with headphones.
3. Background Safari, lock/unlock the phone, rotate screen orientation, and return.
4. Confirm the camera and sensor-spatial visual fallback recover together with at most one audio context.
5. Turn FIND audio off, leave and re-enter FIND, and confirm the independent preference remains off.

## Unsupported browsers

1. Test without Web Audio support and with a suspended/blocked `AudioContext`.
2. Confirm camera-only or map fallback remains usable.
3. Confirm the audio control does not trigger repeated prompts or uncaught errors.
4. Confirm hidden/background lifecycle remains silent.

Spatial accuracy and sound level must be judged on physical devices. Desktop simulation validates state transitions and calculation boundaries only.