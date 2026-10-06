import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const recipes = sqliteTable('recipes', {id: text('id').primaryKey(),url: text('url').notNull().unique(),body: text('body').notNull(),created: text('created').notNull()});
export const crawlState = sqliteTable('crawl_state', {key:text('key').primaryKey(),body:text('body').notNull(),busyUntil:integer('busy_until').notNull().default(0)});
export const crawlQueue = sqliteTable('crawl_queue',{url:text('url').primaryKey(),host:text('host').notNull(),status:text('status').notNull().default('pending'),nextAt:integer('next_at').notNull().default(0),error:text('error')},t=>[index('crawl_queue_due').on(t.host,t.nextAt)]);
