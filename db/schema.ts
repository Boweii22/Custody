import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Versioned compare-and-swap serializes receipt-chain appends across Workers.
export const custodyState = sqliteTable("custody_state", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});
export const custodyRateLimits = sqliteTable("custody_rate_limits", {
  id: text("id").primaryKey(),
  bucket: integer("bucket").notNull(),
  count: integer("count").notNull().default(0),
});
