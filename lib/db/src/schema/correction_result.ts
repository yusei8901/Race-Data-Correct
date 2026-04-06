import { pgTable, uuid, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { correctionSessionTable } from "./correction_session";
import { usersTable } from "./users";

export const correctionResultTable = pgTable("correction_result", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => correctionSessionTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  correctedBy: uuid("corrected_by").references(() => usersTable.id, { onDelete: "set null" }),
  correctedAt: timestamp("corrected_at", { withTimezone: true }).notNull().defaultNow(),
  correctionData: jsonb("correction_data").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCorrectionResultSchema = createInsertSchema(correctionResultTable).omit({ id: true, createdAt: true });
export type InsertCorrectionResult = z.infer<typeof insertCorrectionResultSchema>;
export type CorrectionResult = typeof correctionResultTable.$inferSelect;
