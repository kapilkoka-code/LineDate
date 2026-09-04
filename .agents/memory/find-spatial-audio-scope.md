---
name: FIND spatial audio scope
description: Durable accuracy, lifecycle, and authority boundaries for LINE's spatial sound layer.
---

FIND audio is a secondary, bearing-based rendering layer. Its stereo width may never imply more precision than orientation confidence provides, and it must become centered atmosphere when direction is unavailable or stale. Do not describe it as world-locked in WebXR without physical coordinate-aligned validation.

**Why:** Server bearings are deliberately coarse, mobile Web Audio output varies, and the orientation session is paused during immersive XR. A delayed AudioContext resume can also resurrect sound after FIND hides unless scene ownership is generation-safe.

**How to apply:** Initialize only from a user gesture, smooth sparse voices from authorized server distance/bearing, invalidate pending scene work before suspend/dispose, preserve independent mute, and treat visuals plus server unlock state as authoritative.