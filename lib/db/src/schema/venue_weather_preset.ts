import { pgTable, uuid, varchar, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const venueWeatherPresetTable = pgTable("venue_weather_preset", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueCode: varchar("venue_code", { length: 20 }).notNull(),
  weatherPresetCode: varchar("weather_preset_code", { length: 50 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  surfaceType: varchar("surface_type", { length: 20 }),
  presetParameters: jsonb("preset_parameters").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVenueWeatherPresetSchema = createInsertSchema(venueWeatherPresetTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVenueWeatherPreset = z.infer<typeof insertVenueWeatherPresetSchema>;
export type VenueWeatherPreset = typeof venueWeatherPresetTable.$inferSelect;
