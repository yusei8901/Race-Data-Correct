import { pgTable, uuid, varchar, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const correctionMemoMasterTable = pgTable("correction_memo_master", {
  id: uuid("id").primaryKey().defaultRandom(),
  memoText: varchar("memo_text", { length: 200 }).notNull(),
  displayOrder: integer("display_order").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertCorrectionMemoMasterSchema = createInsertSchema(correctionMemoMasterTable).omit({ id: true });
export type InsertCorrectionMemoMaster = z.infer<typeof insertCorrectionMemoMasterSchema>;
export type CorrectionMemoMaster = typeof correctionMemoMasterTable.$inferSelect;
