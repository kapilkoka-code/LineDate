---
name: Spatial discovery privacy
description: Privacy boundary for God’s Eye discovery, FIND handoff, and proximity checks.
---

Spatial discovery must not turn an opaque handle into a coordinate oracle. Discovery and FIND guidance use immutable snapshots derived from a fixed coarse cell; replaying a handle from caller-chosen locations must not change target presence, distance, bearing, or unlock state. Resolve and proximity-attempt budgets must be enforced across every session and API instance, not in process or session-local memory.

**Why:** A short-lived opaque identifier still exposes a hidden location if callers can replay it and compare coordinate-dependent responses. Browser geolocation is not cryptographically attested, so the web flow needs strict replay bounds rather than claiming physical proof.

**How to apply:** Keep exact coordinates server-only, use purpose-bound encrypted capabilities, store one-time and attempt guards in shared atomic storage, animate movement against a synthetic client target, and reserve true distance for the bounded final content authorization.