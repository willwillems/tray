# Backup and Restore

Tray uses SQLite's `VACUUM INTO` for binary database backups. This creates a compacted, consistent, byte-perfect copy of your entire database -- all tables, indexes, FTS5 search indexes, triggers, and data.

## Creating a Backup

```bash
# Backup with auto-generated filename
tray backup
# Output: Backup created: /Users/you/.tray/data-backup-2024-01-15T10-30-00.db

# Backup to a specific path
tray backup ~/backups/inventory-jan.db

# Backup a specific database
tray backup --db /path/to/inventory.db ~/backups/backup.db
```

The backup file is a fully functional SQLite database. You can open it directly:

```bash
sqlite3 ~/backups/inventory-jan.db "SELECT name, stock FROM parts"
```

## Restoring from a Backup

```bash
tray restore ~/backups/inventory-jan.db
```

This is a **destructive, full replacement**:

1. Your current database is saved as `data.db.pre-restore` (safety net)
2. The backup file replaces your current database
3. Stale WAL/SHM files are cleaned up

You'll be prompted for confirmation:

```
This will REPLACE the database at: /Users/you/.tray/data.db
With backup from: /Users/you/backups/inventory-jan.db
The current database will be saved as: /Users/you/.tray/data.db.pre-restore

Continue? [y/N]
```

Skip the prompt with `--yes`:

```bash
tray restore ~/backups/inventory-jan.db --yes
```

## What's Included

The backup contains **everything in the SQLite database**:

- All parts, categories, tags, parameters
- All stock lots and storage locations
- All suppliers, supplier parts, price breaks
- All projects, BOMs, build orders, purchase orders
- Audit log history
- FTS5 search indexes
- User data

## What's Not Included

**Attachment files** (datasheets, images, CAD files stored on disk) are not included in the backup. Only the attachment *metadata* (filename, hash, URL, size) is preserved in the database.

If you need to back up attachments, copy the `~/.tray/attachments/` directory separately.

## Why VACUUM INTO

Tray uses `VACUUM INTO` instead of a SQL text dump for several reasons:

- **Speed:** Binary copy is faster than generating and parsing SQL statements
- **Correctness:** FTS5 virtual tables, triggers, and indexes are preserved exactly. A SQL dump would require rebuilding FTS5 indexes on restore.
- **Compaction:** `VACUUM INTO` defragments the database, so backups are always optimally sized
- **Simplicity:** Restore is just replacing a file. No SQL parsing, no migration logic.

## Scheduling Backups

Use your OS's scheduler to run backups automatically:

```bash
# macOS (launchd) or Linux (cron)
# Run daily at 2am:
0 2 * * * /usr/local/bin/tray backup ~/backups/tray-$(date +\%Y\%m\%d).db
```

## Recovery Scenarios

### "I accidentally deleted a part"

```bash
# Your pre-restore database has it
tray restore ~/.tray/data.db.pre-restore --yes
```

### "I want to undo the last hour of changes"

If you have a recent backup:

```bash
tray restore ~/backups/tray-20240115.db --yes
```

### "I need to move my inventory to a new machine"

```bash
# On old machine
tray backup ~/inventory-backup.db
# Transfer the file to the new machine
# On new machine
tray restore ~/inventory-backup.db
```
