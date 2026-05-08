import { pgTable, text, serial, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  clerkUserId: text("clerk_user_id").unique(),
  stripeCustomerId: text("stripe_customer_id"),
  role: text("role").default("user"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const whitelistEmails = pgTable("whitelist_emails", {
  id: serial("id").primaryKey(),
  email: text("email").unique().notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
});
