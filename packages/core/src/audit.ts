/**
 * Audit log: record, query, and revert mutations.
 *
 * Every create/update/delete records old_values and new_values as JSON.
 */

import type { Kysely } from "kysely";
import type { AuditLogEntry, Database } from "./schema.ts";

/**
 * Record an audit log entry.
 */
export async function recordAudit(
  db: Kysely<Database>,
  entry: {
    entity_type: string;
    entity_id: number;
    action: "create" | "update" | "delete";
    old_values?: Record<string, unknown> | null;
    new_values?: Record<string, unknown> | null;
    user?: string | null;
  },
): Promise<AuditLogEntry> {
  return await db
    .insertInto("audit_log")
    .values({
      timestamp: new Date().toISOString(),
      user: entry.user ?? null,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      action: entry.action,
      old_values: entry.old_values ? JSON.stringify(entry.old_values) : null,
      new_values: entry.new_values ? JSON.stringify(entry.new_values) : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Query audit log entries with optional filters.
 */
export async function queryAuditLog(
  db: Kysely<Database>,
  filters?: {
    entity_type?: string;
    entity_id?: number;
    action?: string;
    user?: string;
    since?: string; // ISO 8601
    limit?: number;
    offset?: number;
  },
): Promise<AuditLogEntry[]> {
  let query = db.selectFrom("audit_log").selectAll();

  if (filters?.entity_type) {
    query = query.where("entity_type", "=", filters.entity_type);
  }
  if (filters?.entity_id) {
    query = query.where("entity_id", "=", filters.entity_id);
  }
  if (filters?.action) {
    query = query.where("action", "=", filters.action);
  }
  if (filters?.user) {
    query = query.where("user", "=", filters.user);
  }
  if (filters?.since) {
    query = query.where("timestamp", ">=", filters.since);
  }

  query = query.orderBy("timestamp", "desc");

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }
  if (filters?.offset) {
    query = query.offset(filters.offset);
  }

  return await query.execute();
}

/**
 * Get a single audit log entry by ID.
 */
export async function getAuditEntry(
  db: Kysely<Database>,
  id: number,
): Promise<AuditLogEntry | undefined> {
  return await db
    .selectFrom("audit_log")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}
