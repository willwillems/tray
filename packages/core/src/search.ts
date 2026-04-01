/**
 * Search: FTS5 full-text search with fuzzy fallback.
 *
 * Primary: FTS5 across name, description, manufacturer, mpn, ipn, keywords.
 * Fallback: LIKE '%query%' when FTS5 returns zero results.
 * Tags are searched via junction table join.
 */

import { type Kysely, sql } from "kysely";
import type { Database, Part } from "./schema.ts";

export interface SearchResult {
  part: Part;
  rank: number;
  tags: string[];
}

/**
 * Full-text search with automatic fuzzy fallback.
 */
export async function searchParts(
  db: Kysely<Database>,
  query: string,
  options?: { limit?: number; offset?: number },
): Promise<SearchResult[]> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  // Try FTS5 first
  const ftsResults = await ftsSearch(db, query, limit, offset);
  if (ftsResults.length > 0) {
    return ftsResults;
  }

  // Fallback: LIKE search
  return await likeSearch(db, query, limit, offset);
}

/**
 * FTS5 search using SQLite's built-in ranking.
 */
async function ftsSearch(
  db: Kysely<Database>,
  query: string,
  limit: number,
  offset: number,
): Promise<SearchResult[]> {
  // Sanitize query for FTS5 -- escape special chars, add prefix matching
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  const rows = await sql<{ id: number; rank: number }>`
    SELECT p.id, fts.rank
    FROM parts_fts fts
    JOIN parts p ON p.id = fts.rowid
    WHERE parts_fts MATCH ${sanitized}
    ORDER BY fts.rank
    LIMIT ${limit} OFFSET ${offset}
  `.execute(db);

  if (rows.rows.length === 0) return [];

  // Fetch full parts + tags
  return await enrichResults(db, rows.rows);
}

/**
 * LIKE-based fallback search.
 */
async function likeSearch(
  db: Kysely<Database>,
  query: string,
  limit: number,
  offset: number,
): Promise<SearchResult[]> {
  const pattern = `%${query}%`;

  const parts = await db
    .selectFrom("parts")
    .selectAll()
    .where((eb) =>
      eb.or([
        eb("name", "like", pattern),
        eb("description", "like", pattern),
        eb("manufacturer", "like", pattern),
        eb("mpn", "like", pattern),
        eb("ipn", "like", pattern),
        eb("keywords", "like", pattern),
      ])
    )
    .orderBy("name")
    .limit(limit)
    .offset(offset)
    .execute();

  // Also search tags
  const tagParts = await db
    .selectFrom("part_tags")
    .innerJoin("parts", "parts.id", "part_tags.part_id")
    .selectAll("parts")
    .where("part_tags.tag", "like", pattern)
    .limit(limit)
    .execute();

  // Merge and deduplicate
  const seen = new Set<number>();
  const allParts: Part[] = [];
  for (const p of [...parts, ...tagParts]) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      allParts.push(p);
    }
  }

  // Fetch tags for results
  const results: SearchResult[] = [];
  for (const part of allParts.slice(0, limit)) {
    const tags = await getPartTags(db, part.id);
    results.push({ part, rank: 0, tags });
  }

  return results;
}

/**
 * Enrich search results with full part data and tags.
 */
async function enrichResults(
  db: Kysely<Database>,
  rows: { id: number; rank: number }[],
): Promise<SearchResult[]> {
  const ids = rows.map((r) => r.id);
  const rankMap = new Map(rows.map((r) => [r.id, r.rank]));

  const parts = await db
    .selectFrom("parts")
    .selectAll()
    .where("id", "in", ids)
    .execute();

  const results: SearchResult[] = [];
  for (const part of parts) {
    const tags = await getPartTags(db, part.id);
    results.push({
      part,
      rank: rankMap.get(part.id) ?? 0,
      tags,
    });
  }

  // Sort by rank (FTS5 rank is negative; more negative = better match)
  results.sort((a, b) => a.rank - b.rank);
  return results;
}

/**
 * Get tags for a part.
 */
export async function getPartTags(
  db: Kysely<Database>,
  partId: number,
): Promise<string[]> {
  const rows = await db
    .selectFrom("part_tags")
    .select("tag")
    .where("part_id", "=", partId)
    .orderBy("tag")
    .execute();
  return rows.map((r) => r.tag);
}

/**
 * Set tags for a part (replaces all existing tags).
 */
export async function setPartTags(
  db: Kysely<Database>,
  partId: number,
  tags: string[],
): Promise<void> {
  // Delete existing tags
  await db.deleteFrom("part_tags").where("part_id", "=", partId).execute();

  // Insert new tags
  if (tags.length > 0) {
    const unique = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    await db
      .insertInto("part_tags")
      .values(unique.map((tag) => ({ part_id: partId, tag })))
      .execute();
  }
}

/**
 * List all unique tags with usage counts.
 */
export async function listAllTags(
  db: Kysely<Database>,
): Promise<{ tag: string; count: number }[]> {
  const rows = await sql<{ tag: string; count: number }>`
    SELECT tag, COUNT(*) as count
    FROM part_tags
    GROUP BY tag
    ORDER BY count DESC, tag ASC
  `.execute(db);
  return rows.rows;
}

/**
 * Sanitize a user query for FTS5 MATCH.
 * Escapes special characters and adds prefix matching for the last term.
 */
function sanitizeFtsQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";

  // Split into words, escape double quotes
  const words = trimmed
    .replace(/"/g, '""')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "";

  // Add prefix matching to the last word (for typeahead-style search)
  // e.g. "NE55" -> "NE55*"
  const last = words[words.length - 1];
  if (!last.endsWith("*")) {
    words[words.length - 1] = `${last}*`;
  }

  return words.join(" ");
}
