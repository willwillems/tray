/**
 * BlobStore: abstract content-addressed blob storage.
 *
 * This is the single abstraction that decouples core from the filesystem.
 * Every platform provides its own implementation:
 *
 *   - FsBlobStore:     local filesystem (node:fs + node:crypto)
 *   - MemoryBlobStore: in-memory Map (tests)
 *   - R2BlobStore:     Cloudflare R2 (future, in packages/worker/)
 *
 * Keys are content-addressed: {sha256[0:2]}/{sha256}.{ext}
 * Implementations handle their own directory structure / key namespacing.
 */

/**
 * Abstract blob storage backend.
 *
 * All methods are async to accommodate both sync (filesystem) and genuinely
 * async (R2, S3, etc.) backends behind the same interface.
 */
export interface BlobStore {
  /** Store a blob by key. Overwrites if key already exists. */
  put(key: string, data: Uint8Array): Promise<void>;

  /** Read a blob by key. Throws if not found. */
  get(key: string): Promise<Uint8Array>;

  /** Check if a blob exists by key. */
  has(key: string): Promise<boolean>;

  /** Delete a blob by key. No-op if not found. */
  delete(key: string): Promise<void>;

  /**
   * Compute SHA-256 hash of data, return lowercase hex string.
   *
   * Hashing lives on the store because it's platform-dependent:
   *   - Local: node:crypto createHash (sync)
   *   - Cloudflare: crypto.subtle.digest (async, Web Crypto)
   *   - Tests: crypto.subtle.digest (Deno has Web Crypto)
   */
  hash(data: Uint8Array): Promise<string>;
}
