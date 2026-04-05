import { pgTable, uuid, varchar, integer, text, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const racesTable = pgTable("races", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceDate: date("race_date").notNull(),
  venue: varchar("venue", { length: 50 }).notNull(),
  raceType: varchar("race_type", { length: 20 }).notNull(),
  raceNumber: integer("race_number").notNull(),
  raceName: varchar("race_name", { length: 100 }).notNull(),
  surfaceType: varchar("surface_type", { length: 10 }).notNull(),
  distance: integer("distance").notNull(),
  direction: varchar("direction", { length: 20 }),
  weather: varchar("weather", { length: 20 }),
  condition: varchar("condition", { length: 10 }),
  startTime: varchar("start_time", { length: 10 }),
  status: varchar("status", { length: 20 }).notNull().default("未処理"),
  videoStatus: varchar("video_status", { length: 10 }).default("未"),
  videoUrl: text("video_url"),
  analysisStatus: varchar("analysis_status", { length: 20 }).default("未"),
  assignedUser: varchar("assigned_user", { length: 50 }),
  lockedBy: varchar("locked_by", { length: 50 }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  reanalysisReason: varchar("reanalysis_reason", { length: 50 }),
  reanalysisComment: text("reanalysis_comment"),
  correctionRequestComment: text("correction_request_comment"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRaceSchema = createInsertSchema(racesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRace = z.infer<typeof insertRaceSchema>;
export type Race = typeof racesTable.$inferSelect;
