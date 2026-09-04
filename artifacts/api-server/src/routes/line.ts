import {
  AuthorizeLineDropBody,
  AuthorizeLineDropResponse,
  ConfirmLineDropBody,
  ConfirmLineDropResponse,
  CreateLineReplyBody,
  CreateLineReplyParams,
  CreateLineReplyResponse,
  GetLineLetterParams,
  GetLineLetterQueryParams,
  GetLineLetterResponse,
  GetLineProfileResponse,
  GetMyLineLettersResponse,
  GetMyLineRepliesQueryParams,
  GetMyLineRepliesResponse,
  GetNearbyLineLettersQueryParams,
  GetNearbyLineLettersResponse,
  GetLineSignalFieldQueryParams,
  GetLineSignalFieldResponse,
  ResolveLineSignalBody,
  ResolveLineSignalResponse,
  GetRepliesForLetterParams,
  GetRepliesForLetterQueryParams,
  GetRepliesForLetterResponse,
  RevealLineIdentityBody,
  RevealLineIdentityParams,
  RevealLineIdentityResponse,
  UpdateLineProfileBody,
  UpdateLineProfileResponse,
} from "@workspace/api-zod";
import {
  db,
  identityRelationshipsTable,
  lettersTable,
  repliesTable,
  signalGuardsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, gte, lte, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  getSession,
  getSessionId,
  updateSession,
} from "../lib/auth";

const DISCOVERY_RANGE_METERS = 100;
const UNLOCK_DISTANCE_METERS = 10;
const BEARING_SECTOR_DEGREES = 15;
const SIGNAL_FIELD_CELL_METERS = 25;
const SIGNAL_FIELD_RADIUS_METERS = 82;
const SIGNAL_FIELD_LIMIT = 18;
const SIGNAL_HANDLE_TTL_MS = 10 * 60_000;
const DROP_HANDLE_TTL_MS = 5 * 60_000;
const DROP_MAX_ACCURACY_METERS = 25;
const DROP_MAX_OBSERVATION_AGE_MS = 15_000;
const DROP_MAX_TRAVEL_SPEED_MPS = 3;
const SIGNAL_FIELD_RATE_LIMIT = 30;
const router: IRouter = Router();

type SignalCapability = {
  version: 1;
  kind: "field" | "find" | "unlocked";
  letterId: string;
  userId: string;
  cellKey: string | null;
  expiresAt: number;
  guidanceDistance: number | null;
  guidanceBearing: number | null;
  originLatitude: number | null;
  originLongitude: number | null;
};

type DropCapability = {
  version: 1;
  userId: string;
  letterId: string;
  text: string;
  originLatitude: number;
  originLongitude: number;
  originAccuracy: number;
  issuedAt: number;
  expiresAt: number;
};

let signalCapabilityKey: Buffer | null = null;

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadius = 6_371_000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function privacySafeBearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const degrees = (value: number) => (value * 180) / Math.PI;
  const startLatitude = radians(lat1);
  const endLatitude = radians(lat2);
  const longitudeDelta = radians(lon2 - lon1);
  const y = Math.sin(longitudeDelta) * Math.cos(endLatitude);
  const x =
    Math.cos(startLatitude) * Math.sin(endLatitude)
    - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitudeDelta);
  const bearing = (degrees(Math.atan2(y, x)) + 360) % 360;
  return Math.round(bearing / BEARING_SECTOR_DEGREES) * BEARING_SECTOR_DEGREES % 360;
}

function bearingSector(lat1: number, lon1: number, lat2: number, lon2: number) {
  const quantized = privacySafeBearingDegrees(lat1, lon1, lat2, lon2);
  return (["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const)[
    Math.round(quantized / 45) % 8
  ];
}

function distanceBand(distance: number) {
  if (distance <= 25) return "close" as const;
  if (distance <= 55) return "local" as const;
  return "distant" as const;
}

function spatialCell(latitude: number, longitude: number, cellMeters: number) {
  const latitudeSize = cellMeters / 111_320;
  const latitudeIndex = Math.floor((latitude + 90) / latitudeSize);
  const centerLatitude = Math.max(
    -90,
    Math.min(90, -90 + (latitudeIndex + 0.5) * latitudeSize),
  );
  const cosine = Math.max(
    0.01,
    Math.abs(Math.cos((centerLatitude * Math.PI) / 180)),
  );
  const longitudeSize = Math.min(
    360,
    cellMeters / (111_320 * cosine),
  );
  const longitudeIndex = Math.floor((longitude + 180) / longitudeSize);
  const centerLongitude = Math.max(
    -180,
    Math.min(180, -180 + (longitudeIndex + 0.5) * longitudeSize),
  );
  return {
    latitude: centerLatitude,
    longitude: centerLongitude,
    key: `${latitudeIndex}:${longitudeIndex}`,
  };
}

function signalFieldCell(latitude: number, longitude: number) {
  return spatialCell(latitude, longitude, SIGNAL_FIELD_CELL_METERS);
}

function getSignalCapabilityKey() {
  if (signalCapabilityKey) return signalCapabilityKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for signal capabilities");
  signalCapabilityKey = createHash("sha256")
    .update(`line-signal-capability:${secret}`)
    .digest();
  return signalCapabilityKey;
}

function signalHandle(
  userId: string,
  letterId: string,
  kind: SignalCapability["kind"],
  cellKey: string | null,
  guidance?: { distance: number; bearing: number },
  origin?: { latitude: number; longitude: number },
) {
  const capability: SignalCapability = {
    version: 1,
    kind,
    letterId,
    userId,
    cellKey,
    expiresAt: Date.now() + SIGNAL_HANDLE_TTL_MS,
    guidanceDistance: guidance?.distance ?? null,
    guidanceBearing: guidance?.bearing ?? null,
    originLatitude: origin?.latitude ?? null,
    originLongitude: origin?.longitude ?? null,
  };
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    getSignalCapabilityKey(),
    initializationVector,
  );
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(capability), "utf8"),
    cipher.final(),
  ]);
  return [
    "sig1",
    initializationVector.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function readSignalHandle(handle: string, userId: string) {
  try {
    const [prefix, encodedVector, encodedPayload, encodedTag, ...remainder] =
      handle.split(".");
    if (
      prefix !== "sig1"
      || !encodedVector
      || !encodedPayload
      || !encodedTag
      || remainder.length
    ) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getSignalCapabilityKey(),
      Buffer.from(encodedVector, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encodedPayload, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const capability = JSON.parse(decrypted) as Partial<SignalCapability>;
    if (
      capability.version !== 1
      || (
        capability.kind !== "field"
        && capability.kind !== "find"
        && capability.kind !== "unlocked"
      )
      || typeof capability.letterId !== "string"
      || capability.userId !== userId
      || (typeof capability.cellKey !== "string" && capability.cellKey !== null)
      || typeof capability.expiresAt !== "number"
      || capability.expiresAt <= Date.now()
      || (
        capability.kind === "find"
        && (
          typeof capability.guidanceDistance !== "number"
          || typeof capability.guidanceBearing !== "number"
          || typeof capability.originLatitude !== "number"
          || typeof capability.originLongitude !== "number"
        )
      )
    ) return null;
    return capability as SignalCapability;
  } catch {
    return null;
  }
}

function dropHandle(
  userId: string,
  letterId: string,
  text: string,
  origin: { latitude: number; longitude: number; accuracy: number },
) {
  const issuedAt = Date.now();
  const capability: DropCapability = {
    version: 1,
    userId,
    letterId,
    text,
    originLatitude: origin.latitude,
    originLongitude: origin.longitude,
    originAccuracy: origin.accuracy,
    issuedAt,
    expiresAt: issuedAt + DROP_HANDLE_TTL_MS,
  };
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    getSignalCapabilityKey(),
    initializationVector,
  );
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(capability), "utf8"),
    cipher.final(),
  ]);
  return [
    "drop1",
    initializationVector.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function readDropHandle(handle: string, userId: string) {
  try {
    const [prefix, encodedVector, encodedPayload, encodedTag, ...remainder] =
      handle.split(".");
    if (
      prefix !== "drop1"
      || !encodedVector
      || !encodedPayload
      || !encodedTag
      || remainder.length
    ) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getSignalCapabilityKey(),
      Buffer.from(encodedVector, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encodedPayload, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const capability = JSON.parse(decrypted) as Partial<DropCapability>;
    if (
      capability.version !== 1
      || capability.userId !== userId
      || typeof capability.letterId !== "string"
      || capability.letterId.length === 0
      || capability.letterId.length > 128
      || typeof capability.text !== "string"
      || capability.text.length === 0
      || capability.text.length > 500
      || typeof capability.originLatitude !== "number"
      || typeof capability.originLongitude !== "number"
      || typeof capability.originAccuracy !== "number"
      || typeof capability.issuedAt !== "number"
      || typeof capability.expiresAt !== "number"
      || capability.expiresAt <= Date.now()
    ) return null;
    return capability as DropCapability;
  } catch {
    return null;
  }
}

function validDropObservation(observation: {
  latitude: number;
  longitude: number;
  accuracy: number;
  observedAt: number;
}) {
  return observation.accuracy <= DROP_MAX_ACCURACY_METERS
    && Math.abs(Date.now() - observation.observedAt) <= DROP_MAX_OBSERVATION_AGE_MS;
}

async function authorizeDropCapability(
  userId: string,
  letterId: string,
  text: string,
  origin: { latitude: number; longitude: number; accuracy: number },
) {
  const digest = signalGuardDigest("drop-letter", letterId);
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0::bigint))`,
    );
    const [existingLetter] = await transaction
      .select({ writerId: lettersTable.writerId })
      .from(lettersTable)
      .where(eq(lettersTable.id, letterId));
    if (existingLetter) return null;
    const [guard] = await transaction
      .select()
      .from(signalGuardsTable)
      .where(eq(signalGuardsTable.digest, digest));
    const now = new Date();
    if (guard?.capability && guard.expiresAt > now) {
      const existingCapability = readDropHandle(guard.capability, userId);
      if (
        existingCapability
        && existingCapability.letterId === letterId
        && existingCapability.text === text
      ) {
        return {
          handle: guard.capability,
          expiresAt: new Date(existingCapability.expiresAt),
        };
      }
      return null;
    }
    const handle = dropHandle(userId, letterId, text, origin);
    const capability = readDropHandle(handle, userId);
    if (!capability) return null;
    const expiresAt = new Date(capability.expiresAt);
    if (guard) {
      await transaction
        .update(signalGuardsTable)
        .set({ count: 1, capability: handle, expiresAt, updatedAt: now })
        .where(eq(signalGuardsTable.digest, digest));
    } else {
      await transaction.insert(signalGuardsTable).values({
        digest,
        count: 1,
        capability: handle,
        expiresAt,
      });
    }
    return { handle, expiresAt };
  });
}

async function activateDrop(
  userId: string,
  handle: string,
  capability: DropCapability,
  observation: { latitude: number; longitude: number; accuracy: number },
) {
  const digest = signalGuardDigest("drop-letter", capability.letterId);
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0::bigint))`,
    );
    if (capability.expiresAt <= Date.now()) return null;
    const [existingLetter] = await transaction
      .select()
      .from(lettersTable)
      .where(eq(lettersTable.id, capability.letterId));
    if (existingLetter) {
      return existingLetter.writerId === userId ? existingLetter : null;
    }
    const [guard] = await transaction
      .select()
      .from(signalGuardsTable)
      .where(eq(signalGuardsTable.digest, digest));
    const now = new Date();
    if (
      !guard
      || guard.capability !== handle
      || guard.expiresAt <= now
    ) return null;
    const [letter] = await transaction
      .insert(lettersTable)
      .values({
        id: capability.letterId,
        writerId: userId,
        text: capability.text,
        latitude: observation.latitude,
        longitude: observation.longitude,
        accuracy: observation.accuracy,
        visibility: "nearby",
        anonymous: true,
        status: "dropped",
        lifecycleKind: "free",
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      })
      .onConflictDoNothing()
      .returning();
    if (letter) return letter;
    const [conflictingLetter] = await transaction
      .select()
      .from(lettersTable)
      .where(eq(lettersTable.id, capability.letterId));
    return conflictingLetter?.writerId === userId ? conflictingLetter : null;
  });
}

async function signalFieldRateLimited(req: Request, userId: string) {
  const sessionId = getSessionId(req);
  if (!sessionId) return true;
  const session = await getSession(sessionId);
  if (!session || session.user.id !== userId) return true;
  const now = Date.now();
  const rateLimit = session.signal_field_rate_limit;
  if (rateLimit && now - rateLimit.window_started_at < 60_000) {
    if (rateLimit.count >= SIGNAL_FIELD_RATE_LIMIT) return true;
    session.signal_field_rate_limit = {
      ...rateLimit,
      count: rateLimit.count + 1,
    };
  } else {
    session.signal_field_rate_limit = {
      window_started_at: now,
      count: 1,
    };
  }
  await updateSession(sessionId, session);
  return false;
}

async function consumeSignalFieldHandle(
  userId: string,
  handle: string,
) {
  return reserveSignalGuard(
    signalGuardDigest("field", userId, handle),
    1,
  );
}

function signalGuardDigest(scope: string, ...values: string[]) {
  return createHmac("sha256", getSignalCapabilityKey())
    .update([scope, ...values].join("\u0000"))
    .digest("base64url");
}

async function reserveSignalGuard(digest: string, maximum: number) {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0::bigint))`,
    );
    const [row] = await transaction
      .select()
      .from(signalGuardsTable)
      .where(eq(signalGuardsTable.digest, digest));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SIGNAL_HANDLE_TTL_MS);
    if (!row) {
      await transaction.insert(signalGuardsTable).values({
        digest,
        count: 1,
        expiresAt,
      });
      return true;
    }
    if (row.expiresAt <= now) {
      await transaction
        .update(signalGuardsTable)
        .set({ count: 1, expiresAt, updatedAt: now })
        .where(eq(signalGuardsTable.digest, digest));
      return true;
    }
    if (row.count >= maximum) return false;
    await transaction
      .update(signalGuardsTable)
      .set({
        count: sql`${signalGuardsTable.count} + 1`,
        updatedAt: now,
      })
      .where(eq(signalGuardsTable.digest, digest));
    return true;
  });
}

async function consumeProximityAttempt(
  userId: string,
  capability: SignalCapability,
) {
  return reserveSignalGuard(
    signalGuardDigest(
      "proximity",
      userId,
      capability.letterId,
      capability.cellKey ?? "",
    ),
    3,
  );
}

function coarseTimeRemaining(expiresAt: Date | null) {
  if (!expiresAt) return null;
  const remainingDays = (expiresAt.getTime() - Date.now()) / 86_400_000;
  if (remainingDays <= 1) return "under_1_day" as const;
  if (remainingDays <= 7) return "under_7_days" as const;
  if (remainingDays <= 30) return "under_30_days" as const;
  return "under_60_days" as const;
}

function lifecycleExpiration(
  lifecycleKind: string,
  expiresAt: Date | null,
  createdAt: Date,
) {
  if (lifecycleKind === "permanent") return null;
  if (expiresAt) return expiresAt;
  const activeDays = lifecycleKind === "premium" ? 60 : 30;
  return new Date(createdAt.getTime() + activeDays * 86_400_000);
}

function isLetterActive(letter: {
  lifecycleKind: string;
  expiresAt: Date | null;
  createdAt: Date;
}, now = new Date()) {
  const expiresAt = lifecycleExpiration(
    letter.lifecycleKind,
    letter.expiresAt,
    letter.createdAt,
  );
  return expiresAt === null || expiresAt > now;
}

function discoveryBounds(latitude: number, longitude: number, radius: number) {
  const latitudeDelta = radius / 111_320;
  const cosine = Math.cos((latitude * Math.PI) / 180);
  const longitudeDelta = Math.abs(cosine) < 0.000001
    ? 180
    : Math.min(180, radius / (111_320 * Math.abs(cosine)));
  const minLongitude = longitude - longitudeDelta;
  const maxLongitude = longitude + longitudeDelta;
  const longitudeBounds = longitudeDelta === 180
    ? undefined
    : minLongitude < -180
      ? or(
          gte(lettersTable.longitude, minLongitude + 360),
          lte(lettersTable.longitude, maxLongitude),
        )
      : maxLongitude > 180
        ? or(
            gte(lettersTable.longitude, minLongitude),
            lte(lettersTable.longitude, maxLongitude - 360),
          )
        : and(
            gte(lettersTable.longitude, minLongitude),
            lte(lettersTable.longitude, maxLongitude),
          );
  return {
    latitudeBounds: and(
      gte(lettersTable.latitude, Math.max(-90, latitude - latitudeDelta)),
      lte(lettersTable.latitude, Math.min(90, latitude + latitudeDelta)),
    ),
    longitudeBounds,
  };
}

function requireUser(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return req.user.id;
}

function invalid(res: Response, message = "Invalid request") {
  return res.status(400).json({ error: message });
}

function letterResponse(letter: typeof lettersTable.$inferSelect, isOwn: boolean) {
  return {
    id: letter.id,
    text: letter.text,
    createdAt: letter.createdAt,
    latitude: letter.latitude,
    longitude: letter.longitude,
    accuracy: letter.accuracy,
    visibility: "nearby" as const,
    anonymous: true as const,
    status: "dropped" as const,
    isOwn,
  };
}

function nearbyLetterResponse(
  letter: typeof lettersTable.$inferSelect,
  distance: number,
  isOwn = false,
) {
  return {
    id: letter.id,
    text: isOwn || distance <= UNLOCK_DISTANCE_METERS ? letter.text : null,
    createdAt: letter.createdAt,
    visibility: "nearby" as const,
    anonymous: true as const,
    status: "dropped" as const,
    isOwn,
    isUnlocked: isOwn || distance <= UNLOCK_DISTANCE_METERS,
    distanceMeters: distance,
  };
}

router.get("/profile", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return res.status(404).json({ error: "Profile not found" });
  res.json(
    GetLineProfileResponse.parse({
      id: user.lineId,
      displayName: user.displayName,
      createdAt: user.createdAt,
    }),
  );
});

router.patch("/profile", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = UpdateLineProfileBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Display name must be between 1 and 40 characters");
  const displayName = parsed.data.displayName.trim();
  if (!displayName) return invalid(res, "Display name cannot be blank");
  const [user] = await db
    .update(usersTable)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();
  res.json(
    UpdateLineProfileResponse.parse({
      id: user.lineId,
      displayName: user.displayName,
      createdAt: user.createdAt,
    }),
  );
});

router.post("/letters/drop/authorize", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = AuthorizeLineDropBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Letter text and location are required");
  const text = parsed.data.text.trim();
  if (!text) return invalid(res, "Letter cannot be blank");
  if (!validDropObservation(parsed.data)) {
    return invalid(res, "Use a fresh location with accuracy of 25m or better");
  }
  const authorization = await authorizeDropCapability(
    userId,
    parsed.data.id,
    text,
    parsed.data,
  );
  if (!authorization) return res.status(409).json({ error: "This letter is already being placed" });
  res.json(AuthorizeLineDropResponse.parse({
    dropHandle: authorization.handle,
    expiresAt: authorization.expiresAt,
  }));
});

router.post("/letters/drop/confirm", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = ConfirmLineDropBody.safeParse(req.body);
  if (!parsed.success || !validDropObservation(parsed.data)) {
    return invalid(res, "Use a fresh location with accuracy of 25m or better");
  }
  const capability = readDropHandle(parsed.data.dropHandle, userId);
  if (!capability) {
    return res.status(409).json({ error: "This placement has expired. Start the drop again." });
  }
  const elapsedSeconds = Math.max(0, (Date.now() - capability.issuedAt) / 1_000);
  const travelAllowance =
    Math.max(8, elapsedSeconds * DROP_MAX_TRAVEL_SPEED_MPS)
    + capability.originAccuracy
    + parsed.data.accuracy;
  if (
    distanceMeters(
      capability.originLatitude,
      capability.originLongitude,
      parsed.data.latitude,
      parsed.data.longitude,
    ) > travelAllowance
  ) {
    return invalid(res, "Your location changed too quickly. Start the drop again.");
  }
  const letter = await activateDrop(userId, parsed.data.dropHandle, capability, parsed.data);
  if (!letter) return res.status(409).json({ error: "This placement was already used" });
  res.status(201).json(ConfirmLineDropResponse.parse(letterResponse(letter, true)));
});

router.get("/letters/nearby", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = GetNearbyLineLettersQueryParams.safeParse(req.query);
  if (!parsed.success) return invalid(res, "A valid location and FIND target are required");
  if (await signalFieldRateLimited(req, userId)) {
    return res.status(429).json({ error: "The signal field is refreshing too quickly" });
  }
  const targetCapability = readSignalHandle(parsed.data.targetHandle, userId);
  if (
    !targetCapability
    || targetCapability.kind !== "find"
  ) {
    return res.status(404).json({ error: "This signal is no longer available" });
  }
  const requestCell = signalFieldCell(
    parsed.data.latitude,
    parsed.data.longitude,
  );
  if (targetCapability.cellKey !== requestCell.key) {
    return res.status(404).json({ error: "This signal is no longer available" });
  }
  const now = new Date();
  const letters = await db
    .select()
    .from(lettersTable)
    .where(and(
      eq(lettersTable.visibility, "nearby"),
      eq(lettersTable.status, "dropped"),
      ne(lettersTable.writerId, userId),
      eq(lettersTable.id, targetCapability.letterId),
      or(
        eq(lettersTable.lifecycleKind, "permanent"),
        sql`COALESCE(
          ${lettersTable.expiresAt},
          ${lettersTable.createdAt} + CASE
            WHEN ${lettersTable.lifecycleKind} = 'premium' THEN INTERVAL '60 days'
            ELSE INTERVAL '30 days'
          END
        ) > ${now}`,
      ),
    ))
    .orderBy(desc(lettersTable.createdAt));
  const nearby = letters.flatMap((letter) => {
    if (!isLetterActive(letter, now)) return [];
    return [
      {
        ...nearbyLetterResponse(letter, DISCOVERY_RANGE_METERS + 1),
        id: parsed.data.targetHandle,
        createdAt: new Date(
          Math.floor(letter.createdAt.getTime() / 86_400_000) * 86_400_000,
        ),
        distanceMeters: targetCapability.guidanceDistance,
        bearingDegrees: targetCapability.guidanceBearing,
      },
    ];
  });
  res.json(GetNearbyLineLettersResponse.parse(nearby));
});

router.get("/signals/field", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = GetLineSignalFieldQueryParams.safeParse(req.query);
  if (!parsed.success) return invalid(res, "A valid location is required");
  if (await signalFieldRateLimited(req, userId)) {
    return res.status(429).json({ error: "The signal field is refreshing too quickly" });
  }

  const cell = signalFieldCell(parsed.data.latitude, parsed.data.longitude);
  const bounds = discoveryBounds(
    cell.latitude,
    cell.longitude,
    SIGNAL_FIELD_RADIUS_METERS,
  );
  const now = new Date();
  const candidates = await db
    .select({
      id: lettersTable.id,
      latitude: lettersTable.latitude,
      longitude: lettersTable.longitude,
      status: lettersTable.status,
      visibility: lettersTable.visibility,
      lifecycleKind: lettersTable.lifecycleKind,
      expiresAt: lettersTable.expiresAt,
      createdAt: lettersTable.createdAt,
    })
    .from(lettersTable)
    .where(and(
      eq(lettersTable.visibility, "nearby"),
      eq(lettersTable.status, "dropped"),
      ne(lettersTable.writerId, userId),
      or(
        eq(lettersTable.lifecycleKind, "permanent"),
        sql`COALESCE(
          ${lettersTable.expiresAt},
          ${lettersTable.createdAt} + CASE
            WHEN ${lettersTable.lifecycleKind} = 'premium' THEN INTERVAL '60 days'
            ELSE INTERVAL '30 days'
          END
        ) > ${now}`,
      ),
      bounds.latitudeBounds,
      bounds.longitudeBounds,
    ))
    .orderBy(asc(lettersTable.createdAt));

  const ranked = candidates
    .flatMap((letter) => {
      const distance = distanceMeters(
        cell.latitude,
        cell.longitude,
        letter.latitude,
        letter.longitude,
      );
      if (
        distance > SIGNAL_FIELD_RADIUS_METERS
        || letter.status !== "dropped"
        || letter.visibility !== "nearby"
        || !isLetterActive(letter, now)
      ) {
        return [];
      }
      return [{ letter, distance }];
    })
    .sort((first, second) => first.distance - second.distance)
    .slice(0, SIGNAL_FIELD_LIMIT)
    .map(({ letter, distance }, index) => {
      const expiresAt = lifecycleExpiration(
        letter.lifecycleKind,
        letter.expiresAt,
        letter.createdAt,
      );
      return {
        handle: signalHandle(userId, letter.id, "field", cell.key),
        hierarchy: index === 0 ? "primary" as const : index === 1 ? "secondary" as const : "tertiary" as const,
        distanceBand: distanceBand(distance),
        bearingSector: bearingSector(
          cell.latitude,
          cell.longitude,
          letter.latitude,
          letter.longitude,
        ),
        availability: "active" as const,
        lifecycleKind: letter.lifecycleKind,
        timeRemaining: coarseTimeRemaining(expiresAt),
      };
    });

  res.json(GetLineSignalFieldResponse.parse(ranked));
});

router.post("/signals/resolve", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = ResolveLineSignalBody.safeParse(req.body);
  if (!body.success) return invalid(res, "A valid signal and location are required");
  const handleRecord = readSignalHandle(body.data.handle, userId);
  const cell = signalFieldCell(body.data.latitude, body.data.longitude);
  if (
    !handleRecord
    || handleRecord.kind !== "field"
    || handleRecord.cellKey !== cell.key
  ) {
    return res.status(404).json({ error: "This signal is no longer available" });
  }
  const [letter] = await db
    .select()
    .from(lettersTable)
    .where(eq(lettersTable.id, handleRecord.letterId));
  if (
    !letter
    || letter.writerId === userId
    || letter.visibility !== "nearby"
    || letter.status !== "dropped"
    || !isLetterActive(letter)
    || distanceMeters(
      body.data.latitude,
      body.data.longitude,
      letter.latitude,
      letter.longitude,
    ) > DISCOVERY_RANGE_METERS
  ) {
    return res.status(404).json({ error: "This signal is no longer available" });
  }
  if (!await consumeSignalFieldHandle(userId, body.data.handle)) {
    return res.status(404).json({ error: "This signal is no longer available" });
  }
  const guidanceDistance = Math.round(distanceMeters(
    cell.latitude,
    cell.longitude,
    letter.latitude,
    letter.longitude,
  ));
  const guidanceBearing = privacySafeBearingDegrees(
    cell.latitude,
    cell.longitude,
    letter.latitude,
    letter.longitude,
  );
  res.json(ResolveLineSignalResponse.parse({
    targetHandle: signalHandle(
      userId,
      letter.id,
      "find",
      cell.key,
      { distance: guidanceDistance, bearing: guidanceBearing },
      { latitude: body.data.latitude, longitude: body.data.longitude },
    ),
  }));
});

router.get("/letters/mine", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const rows = await db
    .select({
      letter: lettersTable,
      replyCount: sql<number>`count(${repliesTable.id})::int`,
    })
    .from(lettersTable)
    .leftJoin(repliesTable, eq(repliesTable.letterId, lettersTable.id))
    .where(eq(lettersTable.writerId, userId))
    .groupBy(lettersTable.id)
    .orderBy(desc(lettersTable.createdAt));
  res.json(
    GetMyLineLettersResponse.parse(
      rows.map(({ letter, replyCount }) => ({ ...letterResponse(letter, true), replyCount })),
    ),
  );
});

router.get("/letters/:letterId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = GetLineLetterParams.safeParse(req.params);
  const query = GetLineLetterQueryParams.safeParse(req.query);
  if (!params.success || !query.success) return invalid(res, "A valid letter and location are required");
  const capability = readSignalHandle(params.data.letterId, userId);
  if (
    params.data.letterId.startsWith("sig1.")
    && capability?.kind !== "find"
    && capability?.kind !== "unlocked"
  ) {
    return res.status(404).json({ error: "Letter not found" });
  }
  const letterId = capability?.letterId ?? params.data.letterId;
  const [letter] = await db.select().from(lettersTable).where(eq(lettersTable.id, letterId));
  if (!letter) return res.status(404).json({ error: "Letter not found" });
  const isOwn = letter.writerId === userId;
  if (!isOwn && !isLetterActive(letter)) {
    return res.status(404).json({ error: "Letter not found" });
  }
  if (capability?.kind === "find") {
    const observationAge = Math.abs(Date.now() - query.data.observedAt);
    const elapsedSeconds = Math.max(
      0,
      (Date.now() - (capability.expiresAt - SIGNAL_HANDLE_TTL_MS)) / 1000,
    );
    const plausibleTravel = Math.max(10, elapsedSeconds * 3) + query.data.accuracy;
    const plausibleLocation = distanceMeters(
      capability.originLatitude!,
      capability.originLongitude!,
      query.data.latitude,
      query.data.longitude,
    ) <= plausibleTravel;
    if (
      observationAge > 15_000
      || !plausibleLocation
      || !await consumeProximityAttempt(userId, capability)
    ) {
      return res.status(429).json({ error: "Start a new FIND before checking again" });
    }
  }
  const distance = distanceMeters(
    query.data.latitude,
    query.data.longitude,
    letter.latitude,
    letter.longitude,
  );
  const unlocked = isOwn
    || capability?.kind === "unlocked"
    || distance <= UNLOCK_DISTANCE_METERS;
  if (!unlocked) return res.status(403).json({ error: "Move within 10m to open this letter" });
  res.json(GetLineLetterResponse.parse({
    ...nearbyLetterResponse(letter, distance, isOwn),
    id: capability?.kind === "find"
      ? signalHandle(userId, letter.id, "unlocked", capability.cellKey)
      : capability
        ? params.data.letterId
        : letter.id,
  }));
});

router.post("/letters/:letterId/replies", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = CreateLineReplyParams.safeParse(req.params);
  const body = CreateLineReplyBody.safeParse(req.body);
  if (!params.success || !body.success) return invalid(res, "Reply text and location are required");
  const text = body.data.text.trim();
  if (!text) return invalid(res, "Reply cannot be blank");
  const capability = readSignalHandle(params.data.letterId, userId);
  if (params.data.letterId.startsWith("sig1.") && capability?.kind !== "unlocked") {
    return res.status(404).json({ error: "Letter not found" });
  }
  const letterId = capability?.letterId ?? params.data.letterId;
  const [letter] = await db.select().from(lettersTable).where(eq(lettersTable.id, letterId));
  if (!letter) return res.status(404).json({ error: "Letter not found" });
  if (letter.writerId === userId) return res.status(403).json({ error: "You cannot reply to your own letter" });
  if (!isLetterActive(letter)) return res.status(404).json({ error: "Letter not found" });
  if (
    !capability
    &&
    distanceMeters(body.data.latitude, body.data.longitude, letter.latitude, letter.longitude) >
    UNLOCK_DISTANCE_METERS
  ) {
    return res.status(403).json({ error: "Move within 10m to reply" });
  }
  const [reply] = await db
    .insert(repliesTable)
    .values({
      id: body.data.id,
      letterId: letter.id,
      senderUserId: userId,
      letterWriterId: letter.writerId,
      text,
      status: "sent",
    })
    .onConflictDoNothing()
    .returning();
  if (!reply) return res.status(409).json({ error: "A reply with this ID already exists" });
  await db
    .insert(identityRelationshipsTable)
    .values({ letterId: letter.id, senderUserId: userId })
    .onConflictDoNothing();
  res.status(201).json(
    CreateLineReplyResponse.parse({
      id: reply.id,
      letterId: capability ? params.data.letterId : reply.letterId,
      text: reply.text,
      createdAt: reply.createdAt,
      status: "sent",
      identityRevealed: false,
      withinRange: true,
      writerLineId: null,
      writerDisplayName: null,
    }),
  );
});

router.get("/letters/:letterId/replies", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = GetRepliesForLetterParams.safeParse(req.params);
  const query = GetRepliesForLetterQueryParams.safeParse(req.query);
  if (!params.success || !query.success) return invalid(res, "A valid letter and location are required");
  const [letter] = await db.select().from(lettersTable).where(eq(lettersTable.id, params.data.letterId));
  if (!letter) return res.status(404).json({ error: "Letter not found" });
  if (letter.writerId !== userId) return res.status(403).json({ error: "Only the writer can read these replies" });
  if (
    distanceMeters(query.data.latitude, query.data.longitude, letter.latitude, letter.longitude) >
    UNLOCK_DISTANCE_METERS
  ) {
    return res.status(403).json({ error: "Move within 10m to open replies" });
  }
  const rows = await db
    .select({
      reply: repliesTable,
      sender: usersTable,
      relationship: identityRelationshipsTable,
    })
    .from(repliesTable)
    .innerJoin(usersTable, eq(usersTable.id, repliesTable.senderUserId))
    .leftJoin(
      identityRelationshipsTable,
      and(
        eq(identityRelationshipsTable.letterId, repliesTable.letterId),
        eq(identityRelationshipsTable.senderUserId, repliesTable.senderUserId),
      ),
    )
    .where(eq(repliesTable.letterId, letter.id))
    .orderBy(desc(repliesTable.createdAt));
  res.json(
    GetRepliesForLetterResponse.parse(
      rows.map(({ reply, sender, relationship }) => ({
        id: reply.id,
        letterId: reply.letterId,
        text: reply.text,
        createdAt: reply.createdAt,
        status: "sent",
        senderUserId: sender.lineId,
        senderLineId: sender.lineId,
        senderDisplayName: sender.displayName,
        identityRevealed: relationship?.identityRevealed ?? false,
      })),
    ),
  );
});

router.get("/replies/mine", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const query = GetMyLineRepliesQueryParams.safeParse(req.query);
  if (!query.success) return invalid(res, "Invalid location");
  const rows = await db
    .select({
      reply: repliesTable,
      letter: lettersTable,
      writer: usersTable,
      relationship: identityRelationshipsTable,
    })
    .from(repliesTable)
    .innerJoin(lettersTable, eq(lettersTable.id, repliesTable.letterId))
    .innerJoin(usersTable, eq(usersTable.id, lettersTable.writerId))
    .leftJoin(
      identityRelationshipsTable,
      and(
        eq(identityRelationshipsTable.letterId, repliesTable.letterId),
        eq(identityRelationshipsTable.senderUserId, repliesTable.senderUserId),
      ),
    )
    .where(eq(repliesTable.senderUserId, userId))
    .orderBy(desc(repliesTable.createdAt));
  const result = rows.map(({ reply, letter, writer, relationship }) => {
    const withinRange =
      query.data.latitude != null &&
      query.data.longitude != null &&
      distanceMeters(query.data.latitude, query.data.longitude, letter.latitude, letter.longitude) <=
        UNLOCK_DISTANCE_METERS;
    const visible = Boolean(relationship?.identityRevealed && withinRange);
    return {
      id: reply.id,
      letterId: reply.letterId,
      text: reply.text,
      createdAt: reply.createdAt,
      status: "sent" as const,
      identityRevealed: relationship?.identityRevealed ?? false,
      withinRange,
      writerLineId: visible ? writer.lineId : null,
      writerDisplayName: visible ? writer.displayName : null,
    };
  });
  res.json(GetMyLineRepliesResponse.parse(result));
});

router.post("/letters/:letterId/relationships/:senderUserId/reveal", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = RevealLineIdentityParams.safeParse(req.params);
  const body = RevealLineIdentityBody.safeParse(req.body);
  if (!params.success || !body.success) return invalid(res, "A valid relationship and location are required");
  const [letter] = await db.select().from(lettersTable).where(eq(lettersTable.id, params.data.letterId));
  if (!letter || letter.writerId !== userId) return res.status(403).json({ error: "Only the writer can reveal identity" });
  if (
    distanceMeters(body.data.latitude, body.data.longitude, letter.latitude, letter.longitude) >
    UNLOCK_DISTANCE_METERS
  ) {
    return res.status(403).json({ error: "Move within 10m to reveal identity" });
  }
  const [sender] = await db
    .select({ id: usersTable.id, lineId: usersTable.lineId })
    .from(usersTable)
    .where(eq(usersTable.lineId, params.data.senderUserId));
  if (!sender) return res.status(404).json({ error: "Reply relationship not found" });
  const [reply] = await db
    .select({ id: repliesTable.id })
    .from(repliesTable)
    .where(
      and(
        eq(repliesTable.letterId, letter.id),
        eq(repliesTable.senderUserId, sender.id),
      ),
    )
    .limit(1);
  if (!reply) return res.status(404).json({ error: "Reply relationship not found" });
  const [relationship] = await db
    .insert(identityRelationshipsTable)
    .values({
      letterId: letter.id,
      senderUserId: sender.id,
      identityRevealed: true,
    })
    .onConflictDoUpdate({
      target: [identityRelationshipsTable.letterId, identityRelationshipsTable.senderUserId],
      set: { identityRevealed: true, updatedAt: new Date() },
    })
    .returning();
  res.json(
    RevealLineIdentityResponse.parse({
      letterId: relationship.letterId,
      senderUserId: sender.lineId,
      identityRevealed: relationship.identityRevealed,
    }),
  );
});

export default router;