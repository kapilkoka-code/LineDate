import {
  CreateLineLetterBody,
  CreateLineLetterResponse,
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
  GetRepliesForLetterParams,
  GetRepliesForLetterQueryParams,
  GetRepliesForLetterResponse,
  MigrateLocalLineDataBody,
  MigrateLocalLineDataResponse,
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
  usersTable,
} from "@workspace/db";
import { and, desc, eq, gte, lte, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const DISCOVERY_RANGE_METERS = 100;
const UNLOCK_DISTANCE_METERS = 10;
const BEARING_SECTOR_DEGREES = 15;
const router: IRouter = Router();

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

router.post("/letters", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = CreateLineLetterBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Letter text and location are required");
  const text = parsed.data.text.trim();
  if (!text) return invalid(res, "Letter cannot be blank");
  const [letter] = await db
    .insert(lettersTable)
    .values({ ...parsed.data, text, writerId: userId })
    .onConflictDoNothing()
    .returning();
  if (!letter) return res.status(409).json({ error: "A letter with this ID already exists" });
  res.status(201).json(CreateLineLetterResponse.parse(letterResponse(letter, true)));
});

router.get("/letters/nearby", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = GetNearbyLineLettersQueryParams.safeParse(req.query);
  if (!parsed.success) return invalid(res, "A valid location is required");
  const radius = Math.min(parsed.data.radius ?? DISCOVERY_RANGE_METERS, DISCOVERY_RANGE_METERS);
  const latitudeDelta = radius / 111_320;
  const cosine = Math.cos((parsed.data.latitude * Math.PI) / 180);
  const longitudeDelta = Math.abs(cosine) < 0.000001
    ? 180
    : Math.min(180, radius / (111_320 * Math.abs(cosine)));
  const minLongitude = parsed.data.longitude - longitudeDelta;
  const maxLongitude = parsed.data.longitude + longitudeDelta;
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
  const letters = await db
    .select()
    .from(lettersTable)
    .where(and(
      eq(lettersTable.visibility, "nearby"),
      ne(lettersTable.writerId, userId),
      gte(lettersTable.latitude, Math.max(-90, parsed.data.latitude - latitudeDelta)),
      lte(lettersTable.latitude, Math.min(90, parsed.data.latitude + latitudeDelta)),
      longitudeBounds,
    ))
    .orderBy(desc(lettersTable.createdAt));
  const nearby = letters.flatMap((letter) => {
    const distance = distanceMeters(
      parsed.data.latitude,
      parsed.data.longitude,
      letter.latitude,
      letter.longitude,
    );
    if (distance > radius) return [];
    return [
      {
        ...nearbyLetterResponse(letter, distance),
        bearingDegrees: privacySafeBearingDegrees(
          parsed.data.latitude,
          parsed.data.longitude,
          letter.latitude,
          letter.longitude,
        ),
      },
    ];
  });
  res.json(GetNearbyLineLettersResponse.parse(nearby));
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
  const [letter] = await db.select().from(lettersTable).where(eq(lettersTable.id, params.data.letterId));
  if (!letter) return res.status(404).json({ error: "Letter not found" });
  const isOwn = letter.writerId === userId;
  const distance = distanceMeters(
    query.data.latitude,
    query.data.longitude,
    letter.latitude,
    letter.longitude,
  );
  const unlocked = isOwn || distance <= UNLOCK_DISTANCE_METERS;
  if (!unlocked) return res.status(403).json({ error: "Move within 10m to open this letter" });
  res.json(GetLineLetterResponse.parse(nearbyLetterResponse(letter, distance, isOwn)));
});

router.post("/letters/:letterId/replies", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = CreateLineReplyParams.safeParse(req.params);
  const body = CreateLineReplyBody.safeParse(req.body);
  if (!params.success || !body.success) return invalid(res, "Reply text and location are required");
  const text = body.data.text.trim();
  if (!text) return invalid(res, "Reply cannot be blank");
  const [letter] = await db.select().from(lettersTable).where(eq(lettersTable.id, params.data.letterId));
  if (!letter) return res.status(404).json({ error: "Letter not found" });
  if (letter.writerId === userId) return res.status(403).json({ error: "You cannot reply to your own letter" });
  if (
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
      letterId: reply.letterId,
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

router.post("/migration/local", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = MigrateLocalLineDataBody.safeParse(req.body);
  if (!body.success) return invalid(res, "Legacy data is invalid");
  const displayName = body.data.displayName.trim();
  if (displayName) {
    await db
      .update(usersTable)
      .set({ displayName, updatedAt: new Date() })
      .where(and(eq(usersTable.id, userId), eq(usersTable.displayName, "Anonymous User")));
  }
  let migratedLetters = 0;
  for (const source of body.data.letters) {
    const [inserted] = await db
      .insert(lettersTable)
      .values({
        ...source,
        writerId: userId,
        text: source.text.trim(),
        createdAt: source.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: lettersTable.id });
    if (inserted) migratedLetters += 1;
  }
  let migratedReplies = 0;
  for (const source of body.data.replies) {
    const [letter] = await db
      .select()
      .from(lettersTable)
      .where(eq(lettersTable.id, source.letterId));
    if (
      !letter ||
      letter.writerId === userId ||
      distanceMeters(
        body.data.location.latitude,
        body.data.location.longitude,
        letter.latitude,
        letter.longitude,
      ) > UNLOCK_DISTANCE_METERS
    ) {
      continue;
    }
    const [inserted] = await db
      .insert(repliesTable)
      .values({
        id: source.id,
        letterId: letter.id,
        senderUserId: userId,
        letterWriterId: letter.writerId,
        text: source.text.trim(),
        createdAt: source.createdAt,
        status: "sent",
      })
      .onConflictDoNothing()
      .returning({ id: repliesTable.id });
    if (!inserted) continue;
    migratedReplies += 1;
    await db
      .insert(identityRelationshipsTable)
      .values({ letterId: letter.id, senderUserId: userId })
      .onConflictDoNothing();
  }
  res.json(
    MigrateLocalLineDataResponse.parse({
      migratedLetters,
      skippedLetters: body.data.letters.length - migratedLetters,
      migratedReplies,
      skippedReplies: body.data.replies.length - migratedReplies,
      linkedLocalUserId: body.data.localUserId,
    }),
  );
});

export default router;