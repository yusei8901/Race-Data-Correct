import { pgTable, uuid, varchar, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const passingOrdersTable = pgTable("passing_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull(),
  checkpoint: varchar("checkpoint", { length: 20 }).notNull(),
  horseNumber: integer("horse_number").notNull(),
  horseName: varchar("horse_name", { length: 100 }).notNull(),
  gateNumber: integer("gate_number").notNull(),
  color: varchar("color", { length: 10 }),
  lane: varchar("lane", { length: 10 }),
  timeSeconds: numeric("time_seconds", { precision: 6, scale: 2 }),
  accuracy: integer("accuracy"),
  position: integer("position").notNull(),
  isCorrected: boolean("is_corrected").notNull().default(false),
  originalPosition: integer("original_position"),
});

export const insertPassingOrderSchema = createInsertSchema(passingOrdersTable).omit({ id: true });
export type InsertPassingOrder = z.infer<typeof insertPassingOrderSchema>;
export type PassingOrder = typeof passingOrdersTable.$inferSelect;
