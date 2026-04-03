/**
 * `tray backup` -- Create a database backup via VACUUM INTO.
 * `tray restore` -- Restore from a backup file.
 */

import { Command } from "@cliffy/command";
import { createBackup, restoreBackup, setupDb } from "@tray/core";
import { getDbPath } from "../client.ts";

export const backupCommand = new Command()
  .name("backup")
  .description("Create a database backup")
  .arguments("[output:string]")
  .option("--db <path:string>", "Database path")
  .example("Backup with auto name", "tray backup")
  .example("Backup to specific path", "tray backup ~/backups/tray-2024.db")
  .action(async (options, outputPath?) => {
    const dbPath = options.db ?? getDbPath();
    const db = await setupDb(dbPath);

    // Default output: {dbname}-backup-{date}.db
    const backupPath = outputPath ?? generateBackupName(dbPath);

    const result = await createBackup(db, backupPath);
    await db.destroy();

    const sizeKb = (result.size_bytes / 1024).toFixed(1);
    console.log(`Backup created: ${result.path}`);
    console.log(`  Size: ${sizeKb} KB`);
    console.log(`  Time: ${result.timestamp}`);
  });

export const restoreCommand = new Command()
  .name("restore")
  .description("Restore database from a backup file")
  .arguments("<backup:string>")
  .option("--db <path:string>", "Database path to restore into")
  .option("--yes", "Skip confirmation prompt")
  .example("Restore from backup", "tray restore ~/backups/tray-2024.db")
  .example("Restore without confirmation", "tray restore backup.db --yes")
  .action(async (options, backupPath) => {
    const dbPath = options.db ?? getDbPath();

    if (!options.yes) {
      console.log(`This will REPLACE the database at: ${dbPath}`);
      console.log(`With backup from: ${backupPath}`);
      console.log(`The current database will be saved as: ${dbPath}.pre-restore`);
      console.log();

      // Simple confirmation -- read a line from stdin
      const buf = new Uint8Array(10);
      Deno.stdout.writeSync(new TextEncoder().encode("Continue? [y/N] "));
      const n = Deno.stdin.readSync(buf);
      const answer = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        console.log("Restore cancelled.");
        return;
      }
    }

    const result = restoreBackup(dbPath, backupPath);

    console.log(`Database restored successfully.`);
    console.log(`  Restored from: ${result.restored_from}`);
    console.log(`  Previous DB saved as: ${result.previous_saved_as}`);
    console.log(`  Time: ${result.timestamp}`);
  });

function generateBackupName(dbPath: string): string {
  const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = dbPath.replace(/\.db$/, "");
  return `${base}-backup-${date}.db`;
}
