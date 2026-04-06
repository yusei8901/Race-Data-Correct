import { pgTable, uuid, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { raceTable } from "./race";

export const raceLinkageResultTable = pgTable("race_linkage_result", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => raceTable.id, { onDelete: "cascade" }),
  officialRaceId: varchar("official_race_id", { length: 100 }).notNull(),
  linkageStatus: varchar("linkage_status", { length: 30 }).notNull().default("SUCCESS"),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  diffSummary: jsonb("diff_summary").notNull().default({}),
  horseMapping: jsonb("horse_mapping"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRaceLinkageResultSchema = createInsertSchema(raceLinkageResultTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRaceLinkageResult = z.infer<typeof insertRaceLinkageResultSchema>;
export type RaceLinkageResult = typeof raceLinkageResultTable.$inferSelect;
