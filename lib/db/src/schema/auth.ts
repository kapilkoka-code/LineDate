import { index, jsonb, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire", { withTimezone: true }).notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const usersTable = pgTable(
  "users",
  {
    id: varchar("id").primaryKey(),
    lineId: varchar("line_id", { length: 21 }).notNull(),
    displayName: varchar("display_name", { length: 40 }).notNull().default("Anonymous User"),
    email: varchar("email"),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    profileImageUrl: varchar("profile_image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_line_id_unique").on(table.lineId),
    uniqueIndex("users_email_unique").on(table.email),
  ],
);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;