import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const raceCategoryTable = pgTable("race_category", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRaceCategorySchema = createInsertSchema(raceCategoryTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRaceCategory = z.infer<typeof insertRaceCategorySchema>;
export type RaceCategory = typeof raceCategoryTable.$inferSelect;
