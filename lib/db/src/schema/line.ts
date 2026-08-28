import {
  boolean,
  check,
  doublePrecision,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./auth";

export const lettersTable = pgTable(
  "line_letters",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    writerId: varchar("writer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracy: doublePrecision("accuracy").notNull(),
    visibility: varchar("visibility", { length: 24 }).notNull().default("nearby"),
    anonymous: boolean("anonymous").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    status: varchar("status", { length: 24 }).notNull().default("dropped"),
  },
  (table) => [
    index("line_letters_writer_idx").on(table.writerId),
    index("line_letters_created_idx").on(table.createdAt),
    check("line_letters_text_length", sql`char_length(${table.text}) BETWEEN 1 AND 500`),
    check("line_letters_latitude_range", sql`${table.latitude} BETWEEN -90 AND 90`),
    check("line_letters_longitude_range", sql`${table.longitude} BETWEEN -180 AND 180`),
    check("line_letters_accuracy_positive", sql`${table.accuracy} >= 0`),
  ],
);

export const repliesTable = pgTable(
  "line_replies",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    letterId: varchar("letter_id", { length: 128 })
      .notNull()
      .references(() => lettersTable.id, { onDelete: "cascade" }),
    senderUserId: varchar("sender_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    letterWriterId: varchar("letter_writer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    status: varchar("status", { length: 24 }).notNull().default("sent"),
  },
  (table) => [
    index("line_replies_letter_idx").on(table.letterId),
    index("line_replies_sender_idx").on(table.senderUserId),
    index("line_replies_writer_idx").on(table.letterWriterId),
    check("line_replies_text_length", sql`char_length(${table.text}) BETWEEN 1 AND 500`),
  ],
);

export const identityRelationshipsTable = pgTable(
  "line_identity_relationships",
  {
    letterId: varchar("letter_id", { length: 128 })
      .notNull()
      .references(() => lettersTable.id, { onDelete: "cascade" }),
    senderUserId: varchar("sender_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    identityRevealed: boolean("identity_revealed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.letterId, table.senderUserId] }),
    index("line_identity_sender_idx").on(table.senderUserId),
  ],
);

export type LetterRecord = typeof lettersTable.$inferSelect;
export type NewLetterRecord = typeof lettersTable.$inferInsert;
export type ReplyRecord = typeof repliesTable.$inferSelect;
export type NewReplyRecord = typeof repliesTable.$inferInsert;
export type IdentityRelationship = typeof identityRelationshipsTable.$inferSelect;