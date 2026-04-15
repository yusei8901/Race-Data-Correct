import { pgTable, serial, varchar } from "drizzle-orm/pg-core";

export const raceStatusesTable = pgTable("race_statuses", {
  id: serial("id").primaryKey(),
  statusCode: varchar("status_code", { length: 30 }).notNull().unique(),
  displayName: varchar("display_name", { length: 50 }).notNull(),
  tabGroup: varchar("tab_group", { length: 50 }).notNull(),
});

export type RaceStatus = typeof raceStatusesTable.$inferSelect;
