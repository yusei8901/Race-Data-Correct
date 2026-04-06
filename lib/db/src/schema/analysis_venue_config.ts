import { pgTable, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const analysisVenueConfigTable = pgTable("analysis_venue_config", {
  venueId: varchar("venue_id", { length: 20 }).primaryKey(),
  venueName: varchar("venue_name", { length: 100 }).notNull(),
  raceType: varchar("race_type", { length: 50 }).notNull(),
  params: jsonb("params").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAnalysisVenueConfigSchema = createInsertSchema(analysisVenueConfigTable);
export type InsertAnalysisVenueConfig = z.infer<typeof insertAnalysisVenueConfigSchema>;
export type AnalysisVenueConfig = typeof analysisVenueConfigTable.$inferSelect;
