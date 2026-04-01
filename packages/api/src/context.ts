/**
 * Hono environment type.
 *
 * All routes access the Kysely database via `c.get("db")`.
 */

import type { Kysely } from "kysely";
import type { Database } from "@tray/core";

export type Env = {
  Variables: {
    db: Kysely<Database>;
    attachments_dir: string;
  };
};
