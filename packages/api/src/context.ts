/**
 * Hono environment type.
 *
 * All routes access the Kysely database via `c.get("db")`
 * and the blob store via `c.get("blobs")`.
 */

import type { Kysely } from "kysely";
import type { BlobStore, Database } from "@tray/core";

export type Env = {
  Variables: {
    db: Kysely<Database>;
    blobs: BlobStore;
  };
};
