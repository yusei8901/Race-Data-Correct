import { pgTable, uuid, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const batchJobTable = pgTable("batch_job", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  cronExpression: varchar("cron_expression", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("停止中"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBatchJobSchema = createInsertSchema(batchJobTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBatchJob = z.infer<typeof insertBatchJobSchema>;
export type BatchJob = typeof batchJobTable.$inferSelect;
