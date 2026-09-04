---
name: Earth-referenced headings
description: Trust boundaries and lifecycle rules for physical directional positioning.
---

Use only a verified earth-referenced source—such as iOS compass heading or explicitly absolute device orientation—to position a signal against a server bearing. Relative orientation alpha is not north-referenced and must fall back to touch.

**Why:** Relative alpha can look stable while maintaining an arbitrary directional offset, which is more misleading than admitting that orientation is unavailable. Accepted headings can also become stale when a sensor stream stalls.

**How to apply:** Reject relative-only samples, expire accepted headings when samples stop, and restore touch control until a fresh earth-referenced sample arrives.