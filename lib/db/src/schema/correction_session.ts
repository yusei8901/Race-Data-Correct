import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { raceTable } from "./race";
import { usersTable } from "./users";

export const correctionSessionTable = pgTable("correction_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => raceTable.id, { onDelete: "cascade" }),
  analysisResultId: uuid("analysis_result_id"),
  analysisJobId: uuid("analysis_job_id"),
  startedBy: uuid("started_by").references(() => usersTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: varchar("status", { length: 30 }).notNull().default("IN_PROGRESS"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCorrectionSessionSchema = createInsertSchema(correctionSessionTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCorrectionSession = z.infer<typeof insertCorrectionSessionSchema>;
export type CorrectionSession = typeof correctionSessionTable.$inferSelect;
