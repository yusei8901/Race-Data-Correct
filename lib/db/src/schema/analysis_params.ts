import { pgTable, uuid, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const venuesTable = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: varchar("venue_id", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 50 }).notNull(),
  raceType: varchar("race_type", { length: 20 }).notNull(),
});

export const analysisParamsTable = pgTable("analysis_params", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: varchar("venue_id", { length: 20 }).notNull().unique(),
  venueName: varchar("venue_name", { length: 50 }).notNull(),
  raceType: varchar("race_type", { length: 20 }).notNull(),
  params: jsonb("params").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAnalysisParamsSchema = createInsertSchema(analysisParamsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAnalysisParams = z.infer<typeof insertAnalysisParamsSchema>;
export type AnalysisParams = typeof analysisParamsTable.$inferSelect;
