---
name: Camera drag controls
description: Preventing camera-style drag surfaces from swallowing nested control clicks.
---

On a full-screen drag surface, begin pointer capture only when the gesture starts outside interactive controls.

**Why:** Pointer capture on the parent changes the pointer-up target and can suppress the click generated for a nested button, even though the control looks enabled.

**How to apply:** Before capturing a pointer for camera or orientation fallback gestures, ignore events whose target is inside a button or other interactive element.