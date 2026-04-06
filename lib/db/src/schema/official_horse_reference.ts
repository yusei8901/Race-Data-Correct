import { pgTable, uuid, varchar, integer, numeric, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const officialHorseReferenceTable = pgTable("official_horse_reference", {
  id: uuid("id").primaryKey().defaultRandom(),
  officialRaceId: varchar("official_race_id", { length: 100 }).notNull(),
  officialHorseId: varchar("official_horse_id", { length: 100 }).notNull(),
  frameNumber: integer("frame_number").notNull(),
  horseNumber: integer("horse_number").notNull(),
  horseName: varchar("horse_name", { length: 100 }).notNull(),
  finishingOrder: integer("finishing_order"),
  cornerPassOrder: varchar("corner_pass_order", { length: 50 }),
  jockeyName: varchar("jockey_name", { length: 50 }),
  trainerName: varchar("trainer_name", { length: 50 }),
  carriedWeight: numeric("carried_weight", { precision: 4, scale: 1 }),
  sexAge: varchar("sex_age", { length: 20 }),
  finishingTime: numeric("finishing_time", { precision: 10, scale: 2 }),
  rawData: jsonb("raw_data").notNull().default({}),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOfficialHorseReferenceSchema = createInsertSchema(officialHorseReferenceTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOfficialHorseReference = z.infer<typeof insertOfficialHorseReferenceSchema>;
export type OfficialHorseReference = typeof officialHorseReferenceTable.$inferSelect;
