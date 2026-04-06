import { pgTable, uuid, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { raceEventTable } from "./race_event";
import { usersTable } from "./users";

export const csvExportJobTable = pgTable("csv_export_job", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => raceEventTable.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 30 }).notNull().default("PENDING"),
  storagePath: varchar("storage_path", { length: 500 }),
  requestedBy: uuid("requested_by").references(() => usersTable.id, { onDelete: "set null" }),
  errorMessage: text("error_message"),
  raceCount: integer("race_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertCsvExportJobSchema = createInsertSchema(csvExportJobTable).omit({ id: true, createdAt: true });
export type InsertCsvExportJob = z.infer<typeof insertCsvExportJobSchema>;
export type CsvExportJob = typeof csvExportJobTable.$inferSelect;
