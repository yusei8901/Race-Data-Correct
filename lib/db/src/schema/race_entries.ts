import { pgTable, uuid, varchar, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const raceEntriesTable = pgTable("race_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull(),
  horseNumber: integer("horse_number").notNull(),
  gateNumber: integer("gate_number").notNull(),
  horseName: varchar("horse_name", { length: 100 }).notNull(),
  jockeyName: varchar("jockey_name", { length: 50 }),
  trainerName: varchar("trainer_name", { length: 50 }),
  last3f: numeric("last_3f", { precision: 5, scale: 1 }),
  finishTime: numeric("finish_time", { precision: 6, scale: 1 }),
  finishPosition: integer("finish_position"),
  margin: numeric("margin", { precision: 5, scale: 1 }),
  color: varchar("color", { length: 10 }),
  lane: varchar("lane", { length: 10 }),
});

export const insertRaceEntrySchema = createInsertSchema(raceEntriesTable).omit({ id: true });
export type InsertRaceEntry = z.infer<typeof insertRaceEntrySchema>;
export type RaceEntry = typeof raceEntriesTable.$inferSelect;
