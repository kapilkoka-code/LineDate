---
name: World AR scope
description: Durable platform and calibration boundaries for LINE world-anchored rendering.
---

Treat browser world AR as a progressive, session-local Android Chrome enhancement. Ordinary iOS Safari remains on the calibrated sensor-spatial path; do not describe camera, GPS, and compass rendering as true AR.

**Why:** WebXR immersive AR is available through ARCore on supported Android Chrome devices but not ordinary iOS Safari. A local XR reference frame also has no guaranteed north alignment.

**How to apply:** Gate entry on high-confidence absolute heading and location, calibrate geographic bearing against the first non-emulated XR viewer pose, keep exact coordinates server-side, and require native ARKit/ARCore for persistent cross-platform geospatial anchors.