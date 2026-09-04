---
name: Spatial signal visibility
description: Rendering rules for performant spatial light cues in camera discovery.
---

Keep directional beam visibility separate from atmospheric edge presence. The beam may fade fully outside the useful view while a weaker, independently positioned haze remains.

**Why:** One shared opacity either makes off-screen signals teleport away or leaves beams too bright at the edge. Animating that opacity also overrides bearing-driven visibility, and repainting particle backgrounds is too costly over a live camera.

**How to apply:** Treat bearing opacity as authoritative, animate only compositor-friendly transforms, and keep particle texture static or bounded.