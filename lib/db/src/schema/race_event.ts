import { pgTable, uuid, varchar, integer, date, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { raceCategoryTable } from "./race_category";

export const raceEventTable = pgTable("race_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id").notNull().references(() => raceCategoryTable.id, { onDelete: "cascade" }),
  eventDate: date("event_date").notNull(),
  venueCode: varchar("venue_code", { length: 20 }).notNull(),
  venueName: varchar("venue_name", { length: 100 }).notNull(),
  round: integer("round").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique().on(t.categoryId, t.eventDate, t.venueCode, t.round),
]);

export const insertRaceEventSchema = createInsertSchema(raceEventTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRaceEvent = z.infer<typeof insertRaceEventSchema>;
export type RaceEvent = typeof raceEventTable.$inferSelect;
