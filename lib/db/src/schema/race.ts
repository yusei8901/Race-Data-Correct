import { pgTable, uuid, integer, varchar, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { raceEventTable } from "./race_event";
import { usersTable } from "./users";

export const raceTable = pgTable("race", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => raceEventTable.id, { onDelete: "cascade" }),
  raceNumber: integer("race_number").notNull(),
  raceName: varchar("race_name", { length: 200 }),
  startTime: varchar("start_time", { length: 10 }),
  surfaceType: varchar("surface_type", { length: 20 }),
  distance: integer("distance"),
  direction: varchar("direction", { length: 20 }),
  weather: varchar("weather", { length: 20 }),
  trackCondition: varchar("track_condition", { length: 20 }),
  status: varchar("status", { length: 30 }).notNull().default("PENDING"),
  currentAnalysisResultId: uuid("current_analysis_result_id"),
  currentCorrectionSessionId: uuid("current_correction_session_id"),
  correctedBy: uuid("corrected_by").references(() => usersTable.id, { onDelete: "set null" }),
  correctedAt: timestamp("corrected_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: uuid("confirmed_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique().on(t.eventId, t.raceNumber),
]);

export const insertRaceSchema = createInsertSchema(raceTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRace = z.infer<typeof insertRaceSchema>;
export type Race = typeof raceTable.$inferSelect;
