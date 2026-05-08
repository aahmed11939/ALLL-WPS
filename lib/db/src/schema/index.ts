import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  clerkUserId: text("clerk_user_id").unique(),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const whitelistEmails = pgTable("whitelist_emails", {
  id: serial("id").primaryKey(),
  email: text("email").unique().notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
