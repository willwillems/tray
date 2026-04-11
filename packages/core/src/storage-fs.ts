/**
 * FsBlobStore: filesystem-backed BlobStore implementation.
 *
 * Used in local mode (single-binary CLI, `tray serve`).
 * Content-addressed storage at: {baseDir}/{key}
 * where key is typically {sha256[0:2]}/{sha256}.{ext}
 *
 * Platform dependencies: node:fs, node:crypto, node:path.
 * These are available in Deno and Node.js but NOT in Cloudflare Workers.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { BlobStore } from "./storage.ts";

export class FsBlobStore implements BlobStore {
  #dir: string;

  constructor(baseDir: string) {
    this.#dir = baseDir;
    mkdirSync(baseDir, { recursive: true });
  }

  // deno-lint-ignore require-await
  async put(key: string, data: Uint8Array): Promise<void> {
    const path = join(this.#dir, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }

  // deno-lint-ignore require-await
  async get(key: string): Promise<Uint8Array> {
    return readFileSync(join(this.#dir, key));
  }

  // deno-lint-ignore require-await
  async has(key: string): Promise<boolean> {
    return existsSync(join(this.#dir, key));
  }

  // deno-lint-ignore require-await
  async delete(key: string): Promise<void> {
    try {
      unlinkSync(join(this.#dir, key));
    } catch {
      // File already gone -- not an error
    }
  }

  // deno-lint-ignore require-await
  async hash(data: Uint8Array): Promise<string> {
    return createHash("sha256").update(data).digest("hex");
  }
}
