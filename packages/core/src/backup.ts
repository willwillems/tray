/**
 * Backup and restore: binary SQLite backup via VACUUM INTO.
 *
 * Backup creates a compacted, consistent copy of the database.
 * Restore replaces the current database file with a backup.
 *
 * Attachments are NOT included -- only the SQLite database.
 * Attachment metadata (filename, hash, URL) IS preserved in the backup.
 */

import { existsSync, copyFileSync, renameSync } from "node:fs";
import { sql, type Kysely } from "kysely";
import type { Database } from "./schema.ts";

/**
 * Create a backup of the database using VACUUM INTO.
 *
 * VACUUM INTO creates a compacted, defragmented copy of the entire database
 * including all tables, indexes, FTS5 virtual tables, and triggers.
 * The backup file is a fully functional SQLite database.
 *
 * @param db - Active Kysely database connection
 * @param outputPath - Path for the backup file (must not exist)
 * @returns Backup metadata
 */
export async function createBackup(
  db: Kysely<Database>,
  outputPath: string,
): Promise<{ path: string; size_bytes: number; timestamp: string }> {
  if (existsSync(outputPath)) {
    throw new Error(`Backup file already exists: ${outputPath}. Remove it first or use a different path.`);
  }

  const timestamp = new Date().toISOString();

  // VACUUM INTO creates a consistent, compacted copy
  await sql`VACUUM INTO ${sql.lit(outputPath)}`.execute(db);

  // Get file size
  const stat = Deno.statSync(outputPath);

  return {
    path: outputPath,
    size_bytes: stat.size,
    timestamp,
  };
}

/**
 * Restore a database from a backup file.
 *
 * This is a destructive operation: the current database is replaced entirely.
 * The original database is saved as {path}.pre-restore as a safety measure.
 *
 * @param currentDbPath - Path to the current database file
 * @param backupPath - Path to the backup file to restore from
 * @returns Restore metadata
 */
export function restoreBackup(
  currentDbPath: string,
  backupPath: string,
): { restored_from: string; previous_saved_as: string; timestamp: string } {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  if (currentDbPath === ":memory:") {
    throw new Error("Cannot restore to an in-memory database");
  }

  // Validate the backup is a valid SQLite database
  validateSqliteFile(backupPath);

  const timestamp = new Date().toISOString();
  const preRestorePath = `${currentDbPath}.pre-restore`;

  // Save current database as .pre-restore (safety net)
  if (existsSync(currentDbPath)) {
    copyFileSync(currentDbPath, preRestorePath);
  }

  // Remove WAL and SHM files BEFORE replacing the database.
  // Stale WAL/SHM files cause "disk I/O error" when opening the restored DB.
  try { Deno.removeSync(`${currentDbPath}-wal`); } catch { /* may not exist */ }
  try { Deno.removeSync(`${currentDbPath}-shm`); } catch { /* may not exist */ }

  // Replace current database with backup
  copyFileSync(backupPath, currentDbPath);

  return {
    restored_from: backupPath,
    previous_saved_as: preRestorePath,
    timestamp,
  };
}

/**
 * Verify a file is a valid SQLite database by checking the magic header.
 */
function validateSqliteFile(path: string): void {
  const file = Deno.openSync(path, { read: true });
  const header = new Uint8Array(16);
  file.readSync(header);
  file.close();

  // SQLite magic: "SQLite format 3\000"
  const magic = new TextDecoder().decode(header);
  if (!magic.startsWith("SQLite format 3")) {
    throw new Error(`File is not a valid SQLite database: ${path}`);
  }
}
