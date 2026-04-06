import { pgTable, uuid, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { officialHorseReferenceTable } from "./official_horse_reference";

export const officialHorseFurlongTimeTable = pgTable("official_horse_furlong_time", {
  id: uuid("id").primaryKey().defaultRandom(),
  officialHorseReferenceId: uuid("official_horse_reference_id").notNull().references(() => officialHorseReferenceTable.id, { onDelete: "cascade" }),
  furlongNo: integer("furlong_no").notNull(),
  timeSec: numeric("time_sec", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOfficialHorseFurlongTimeSchema = createInsertSchema(officialHorseFurlongTimeTable).omit({ id: true, createdAt: true });
export type InsertOfficialHorseFurlongTime = z.infer<typeof insertOfficialHorseFurlongTimeSchema>;
export type OfficialHorseFurlongTime = typeof officialHorseFurlongTimeTable.$inferSelect;
