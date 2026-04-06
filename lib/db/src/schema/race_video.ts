import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { raceTable } from "./race";

export const raceVideoTable = pgTable("race_video", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => raceTable.id, { onDelete: "cascade" }),
  storagePath: varchar("storage_path", { length: 500 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("INCOMPLETE"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRaceVideoSchema = createInsertSchema(raceVideoTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRaceVideo = z.infer<typeof insertRaceVideoSchema>;
export type RaceVideo = typeof raceVideoTable.$inferSelect;
