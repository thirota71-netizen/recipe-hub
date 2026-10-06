import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const recipes = sqliteTable('recipes', {id: text('id').primaryKey(),url: text('url').notNull().unique(),body: text('body').notNull(),created: text('created').notNull()});
