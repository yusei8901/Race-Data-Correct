import { pgTable, uuid, varchar, integer, numeric, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { analysisResultHeaderTable } from "./analysis_result_header";

export const analysisResultDetailTable = pgTable("analysis_result_detail", {
  id: uuid("id").primaryKey().defaultRandom(),
  headerId: uuid("header_id").notNull().references(() => analysisResultHeaderTable.id, { onDelete: "cascade" }),
  timeSec: numeric("time_sec", { precision: 10, scale: 2 }),
  markerType: varchar("marker_type", { length: 50 }),
  className: varchar("class_name", { length: 50 }),
  coursePosition: varchar("course_position", { length: 20 }),
  rank: integer("rank"),
  raceTime: numeric("race_time", { precision: 10, scale: 2 }),
  correctedTime: numeric("corrected_time", { precision: 10, scale: 2 }),
  dataType: varchar("data_type", { length: 20 }),
  sectionNo: integer("section_no"),
  centerlineDy: numeric("centerline_dy", { precision: 10, scale: 4 }),
  correctedSpeed: numeric("corrected_speed", { precision: 10, scale: 2 }),
  speedKmh: numeric("speed_kmh", { precision: 10, scale: 2 }),
  horseNumber: integer("horse_number"),
  horseName: varchar("horse_name", { length: 100 }),
  gateNumber: integer("gate_number"),
  color: varchar("color", { length: 10 }),
  lane: varchar("lane", { length: 10 }),
  accuracy: integer("accuracy"),
  position: integer("position"),
  isCorrected: boolean("is_corrected").notNull().default(false),
  originalPosition: integer("original_position"),
  absoluteSpeed: numeric("absolute_speed", { precision: 8, scale: 2 }),
  speedChange: numeric("speed_change", { precision: 8, scale: 2 }),
  runningPosition: integer("running_position"),
  specialNote: text("special_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAnalysisResultDetailSchema = createInsertSchema(analysisResultDetailTable).omit({ id: true, createdAt: true });
export type InsertAnalysisResultDetail = z.infer<typeof insertAnalysisResultDetailSchema>;
export type AnalysisResultDetail = typeof analysisResultDetailTable.$inferSelect;
