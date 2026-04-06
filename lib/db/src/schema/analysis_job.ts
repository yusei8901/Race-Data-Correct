import { pgTable, uuid, varchar, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { raceVideoTable } from "./race_video";

export const analysisJobTable = pgTable("analysis_job", {
  id: uuid("id").primaryKey().defaultRandom(),
  videoId: uuid("video_id").notNull().references(() => raceVideoTable.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 30 }).notNull().default("PENDING"),
  analysisMode: varchar("analysis_mode", { length: 20 }).notNull().default("200m"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  parameters: jsonb("parameters"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAnalysisJobSchema = createInsertSchema(analysisJobTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAnalysisJob = z.infer<typeof insertAnalysisJobSchema>;
export type AnalysisJob = typeof analysisJobTable.$inferSelect;
