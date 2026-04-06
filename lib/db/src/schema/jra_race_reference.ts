import { pgTable, uuid, varchar, integer, date, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const jraRaceReferenceTable = pgTable("jra_race_reference", {
  id: uuid("id").primaryKey().defaultRandom(),
  officialRaceId: varchar("official_race_id", { length: 100 }).notNull(),
  eventDate: date("event_date").notNull(),
  venueCode: varchar("venue_code", { length: 20 }).notNull(),
  raceNumber: integer("race_number").notNull(),
  weather: varchar("weather", { length: 50 }),
  courseDistance: integer("course_distance"),
  surfaceType: varchar("surface_type", { length: 20 }),
  courseDirection: varchar("course_direction", { length: 20 }),
  coursePosition: varchar("course_position", { length: 20 }),
  startTime: varchar("start_time", { length: 10 }),
  rawData: jsonb("raw_data").notNull().default({}),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertJraRaceReferenceSchema = createInsertSchema(jraRaceReferenceTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJraRaceReference = z.infer<typeof insertJraRaceReferenceSchema>;
export type JraRaceReference = typeof jraRaceReferenceTable.$inferSelect;
