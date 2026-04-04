import { pgTable, uuid, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const batchJobsTable = pgTable("batch_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  cronExpression: varchar("cron_expression", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("停止中"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBatchJobSchema = createInsertSchema(batchJobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBatchJob = z.infer<typeof insertBatchJobSchema>;
export type BatchJob = typeof batchJobsTable.$inferSelect;
