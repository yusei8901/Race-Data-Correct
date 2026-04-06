import { pgTable, uuid, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { analysisJobTable } from "./analysis_job";
import { raceTable } from "./race";

export const analysisResultHeaderTable = pgTable("analysis_result_header", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => analysisJobTable.id, { onDelete: "cascade" }),
  raceId: uuid("race_id").notNull().references(() => raceTable.id, { onDelete: "cascade" }),
  isCurrent: boolean("is_current").notNull().default(true),
  horseCount: integer("horse_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAnalysisResultHeaderSchema = createInsertSchema(analysisResultHeaderTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAnalysisResultHeader = z.infer<typeof insertAnalysisResultHeaderSchema>;
export type AnalysisResultHeader = typeof analysisResultHeaderTable.$inferSelect;
