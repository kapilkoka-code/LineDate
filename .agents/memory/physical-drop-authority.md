---
name: Physical drop authority
description: Security boundary for activating location-bound physical letters.
---

Every active physical letter must pass a user-bound, expiring authorize/confirm ceremony that serializes both phases on one durable letter reservation. Migration, import, retry, or compatibility routes must never directly create active letters.

**Why:** Browser location cannot be cryptographically attested, so freshness, accuracy, plausible movement, immutable encrypted content, and database-backed replay control are the enforceable boundary. An alternate ingest path or process-local lock silently defeats that boundary.

**How to apply:** Any new way to create, restore, import, or retry a physical letter must enter the same reservation and confirmation path. Keep previews client-only; never submit visual repositioning or movement history as authoritative coordinates.