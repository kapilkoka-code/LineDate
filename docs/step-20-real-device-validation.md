# Step 20 real-device validation

Step 20 is not production-validated until the physical-device runs below are completed. Record the device, OS/browser version, result, and any video or console evidence for each run.

## Test preparation

- Use a real account and a disposable, non-sensitive letter.
- Test outdoors or near a window where GPS accuracy can reach 25 m or better.
- Confirm the letter is absent from God’s Eye before placement.
- Do not enable development simulations during physical-device runs.

## Android Chrome with WebXR / ARCore

1. Compose and preview a letter, then choose **DROP THIS LINE**.
2. Choose **OPEN CAMERA TO PLACE** and grant camera, motion, and location access.
3. Confirm immersive AR starts only when the browser reports genuine support.
4. Place the twin-beam preview on the ground and drag to reposition it.
5. Walk and rotate around the preview; confirm it remains stable in the local reference space.
6. Choose **LEAVE IT HERE** once and confirm the preview stabilizes and strengthens.
7. Walk away and verify distance, brightness, and atmosphere respond without moving the stored LINE.
8. Return to Discover, sign in as another test user, find the LINE in God’s Eye, enter FIND, approach it, and unlock it inside 10 m.

## iOS Safari

1. Compose and preview a letter, then choose **DROP THIS LINE**.
2. Choose **OPEN CAMERA TO PLACE** and grant camera, motion, and location access from that gesture.
3. Confirm the experience uses camera-backed sensor/manual placement and never claims persistent world anchoring.
4. Reposition the twin-beam preview, choose **LEAVE IT HERE**, and verify the active walk-away state.
5. Rediscover the LINE from another test account through God’s Eye and FIND, then unlock it inside 10 m.

## Capability and interruption matrix

- Rotate the screen during preview, placement, confirming, and active states.
- Background and foreground the app during placement; confirm it stops camera/XR and requires a safe retry.
- Temporarily cover or disable sensors; confirm manual placement or an explicit failure state.
- Degrade GPS beyond 25 m and use a location older than 15 seconds; confirm the server does not activate a letter.
- Lose WebXR tracking, then regain it or confirm the sensor-camera fallback appears.
- Interrupt the network before authorization and before confirmation; retry without creating duplicates.
- Submit the confirmation twice; confirm only one active letter exists.
- Let authorization expire before confirmation; confirm the flow obtains a fresh authorization.
- Deny camera access; confirm no letter is created.
- Confirm development diagnostics are absent from the production bundle.

## Completion record

Step 20 may be marked **physically validated** only after both platform sections and the interruption matrix pass. Browser simulation, desktop preview, typecheck, and production builds do not replace these runs.