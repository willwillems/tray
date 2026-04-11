/**
 * MemoryBlobStore: in-memory BlobStore implementation.
 *
 * Used in tests alongside `:memory:` SQLite databases.
 * No filesystem, no temp directories, no cleanup.
 *
 * Uses Web Crypto API for hashing (available in Deno and all modern runtimes).
 */

import type { BlobStore } from "./storage.ts";

export class MemoryBlobStore implements BlobStore {
  #blobs = new Map<string, Uint8Array>();

  // deno-lint-ignore require-await
  async put(key: string, data: Uint8Array): Promise<void> {
    // Copy the data so callers can't mutate our internal state
    this.#blobs.set(key, new Uint8Array(data));
  }

  // deno-lint-ignore require-await
  async get(key: string): Promise<Uint8Array> {
    const data = this.#blobs.get(key);
    if (!data) throw new Error(`Blob not found: ${key}`);
    return data;
  }

  // deno-lint-ignore require-await
  async has(key: string): Promise<boolean> {
    return this.#blobs.has(key);
  }

  // deno-lint-ignore require-await
  async delete(key: string): Promise<void> {
    this.#blobs.delete(key);
  }

  async hash(data: Uint8Array): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}
