/**
 * Custom Kysely dialect for Deno's built-in node:sqlite (DatabaseSync).
 *
 * Bridges the synchronous DatabaseSync API to Kysely's async Dialect interface.
 * ~100 lines, one-time write. This is the foundation for all database access.
 */

import {
  CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";
import { DatabaseSync, type SupportedValueType } from "node:sqlite";

export class NodeSqliteDialect implements Dialect {
  #config: NodeSqliteDialectConfig;

  constructor(config: NodeSqliteDialectConfig) {
    this.#config = config;
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createDriver(): Driver {
    return new NodeSqliteDriver(this.#config);
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }
}

export interface NodeSqliteDialectConfig {
  database: DatabaseSync | (() => DatabaseSync);
}

class NodeSqliteDriver implements Driver {
  #config: NodeSqliteDialectConfig;
  #db?: DatabaseSync;

  constructor(config: NodeSqliteDialectConfig) {
    this.#config = config;
  }

  async init(): Promise<void> {
    this.#db = typeof this.#config.database === "function"
      ? this.#config.database()
      : this.#config.database;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new NodeSqliteConnection(this.#db!);
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("BEGIN"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("COMMIT"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }

  // deno-lint-ignore require-await
  async releaseConnection(_connection: DatabaseConnection): Promise<void> {
    // No-op for SQLite -- single connection, no pool
  }

  // deno-lint-ignore require-await
  async destroy(): Promise<void> {
    this.#db?.close();
  }
}

class NodeSqliteConnection implements DatabaseConnection {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  // deno-lint-ignore require-await
  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const { sql, parameters } = compiledQuery;
    const stmt = this.#db.prepare(sql);

    const params = parameters as unknown as SupportedValueType[];

    const upperSql = sql.trimStart().toUpperCase();
    if (upperSql.startsWith("SELECT") || upperSql.startsWith("WITH") || upperSql.includes("RETURNING")) {
      const rows = stmt.all(...params) as R[];
      return { rows };
    }

    const result = stmt.run(...params);
    return {
      rows: [],
      numAffectedRows: BigInt(result.changes),
      insertId: result.lastInsertRowid !== undefined
        ? BigInt(result.lastInsertRowid as number)
        : undefined,
    };
  }

  // deno-lint-ignore require-yield
  async *streamQuery<R>(
    _compiledQuery: CompiledQuery,
    _chunkSize?: number,
  ): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("Streaming is not supported with node:sqlite");
  }
}
