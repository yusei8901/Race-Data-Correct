import { pgTable, uuid, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { raceTable } from "./race";
import { usersTable } from "./users";

export const raceStatusHistoryTable = pgTable("race_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => raceTable.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 30 }).notNull(),
  changedBy: uuid("changed_by").references(() => usersTable.id, { onDelete: "set null" }),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRaceStatusHistorySchema = createInsertSchema(raceStatusHistoryTable).omit({ id: true, createdAt: true });
export type InsertRaceStatusHistory = z.infer<typeof insertRaceStatusHistorySchema>;
export type RaceStatusHistory = typeof raceStatusHistoryTable.$inferSelect;
