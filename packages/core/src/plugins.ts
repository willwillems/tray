/**
 * Plugin system: TypeScript plugins with lifecycle hooks and custom commands.
 *
 * Plugins are registered via ~/.tray/config.ts (Vite-style config-as-code).
 * Hooks are fire-and-forget -- they never block or crash the main operation.
 *
 * @example
 * ```ts
 * // ~/.tray/config.ts
 * import type { TrayConfig } from "@tray/core";
 * import logger from "./plugins/logger.ts";
 *
 * export default {
 *   plugins: [logger()],
 * } satisfies TrayConfig;
 * ```
 */

import type { Kysely } from "kysely";
import type { Database, Part, BuildOrder } from "./schema.ts";
import type { PartWithDetails } from "./parts.ts";

// ---------------------------------------------------------------------------
// Plugin Interface
// ---------------------------------------------------------------------------

/** Context passed to plugin hooks and commands */
export interface PluginContext {
  /** Direct database access (Kysely) */
  db: Kysely<Database>;
  /** Log a message (visible in CLI output) */
  log: (message: string) => void;
}

/** Handler for a custom CLI command provided by a plugin */
export type CommandHandler = (
  ctx: PluginContext,
  args: string[],
) => Promise<void>;

/**
 * A fetch-compatible request handler.
 * Return a Response to handle the request, or null to pass through.
 */
export type MiddlewareHandler = (
  req: Request,
) => Response | null | Promise<Response | null>;

/** The plugin interface. Plugins are functions that return this object. */
export interface TrayPlugin {
  /** Unique plugin name */
  name: string;

  /**
   * Custom CLI commands. Keys are command names, values are handlers.
   * Registered as `tray <name> [args...]`.
   */
  commands?: Record<string, CommandHandler>;

  /**
   * HTTP middleware that runs before the API router in `tray serve`.
   * Return a Response to handle the request, or null to pass through to the
   * next plugin / API router. This enables plugins to serve static files,
   * add custom routes, or inject headers.
   *
   * Middleware handlers are called in plugin registration order.
   * The first handler that returns a Response wins.
   */
  middleware?: MiddlewareHandler;

  // --- Lifecycle Hooks (fire-and-forget, errors are logged) ---

  /** Fired after a part is created */
  onPartCreated?: (ctx: PluginContext, part: PartWithDetails) => Promise<void>;

  /** Fired after a part is updated */
  onPartUpdated?: (
    ctx: PluginContext,
    part: PartWithDetails,
    old: Part,
  ) => Promise<void>;

  /** Fired after a part is deleted */
  onPartDeleted?: (ctx: PluginContext, partId: number) => Promise<void>;

  /** Fired when a part's stock changes (after lot trigger updates Part.stock) */
  onStockChanged?: (
    ctx: PluginContext,
    partId: number,
    oldStock: number,
    newStock: number,
  ) => Promise<void>;

  /** Fired when a part's stock drops to or below min_stock */
  onLowStock?: (ctx: PluginContext, part: PartWithDetails) => Promise<void>;

  /** Fired when a build order is completed */
  onBuildCompleted?: (
    ctx: PluginContext,
    buildOrder: BuildOrder,
  ) => Promise<void>;
}

/** Top-level config exported from ~/.tray/config.ts */
export interface TrayConfig {
  plugins: TrayPlugin[];
}

// ---------------------------------------------------------------------------
// Plugin Engine
// ---------------------------------------------------------------------------

/**
 * The plugin engine manages loaded plugins and dispatches hooks.
 * It is the single coordination point for all plugin activity.
 */
export class PluginEngine {
  #plugins: TrayPlugin[] = [];
  #ctx: PluginContext;

  constructor(ctx: PluginContext) {
    this.#ctx = ctx;
  }

  /** Register plugins (called once after loading config) */
  register(plugins: TrayPlugin[]): void {
    this.#plugins = plugins;
    for (const p of plugins) {
      this.#ctx.log(`[plugin] Loaded: ${p.name}`);
    }
  }

  /** Add a single plugin without re-logging existing ones. */
  addPlugin(plugin: TrayPlugin): void {
    this.#plugins = [...this.#plugins, plugin];
    this.#ctx.log(`[plugin] Loaded: ${plugin.name}`);
  }

  /** Get all registered plugins */
  get plugins(): readonly TrayPlugin[] {
    return this.#plugins;
  }

  /** Get all custom commands from all plugins */
  getCommands(): Map<string, { plugin: string; handler: CommandHandler }> {
    const commands = new Map<string, { plugin: string; handler: CommandHandler }>();
    for (const plugin of this.#plugins) {
      if (plugin.commands) {
        for (const [name, handler] of Object.entries(plugin.commands)) {
          if (commands.has(name)) {
            this.#ctx.log(
              `[plugin] Warning: command '${name}' from '${plugin.name}' overrides same command from '${commands.get(name)!.plugin}'`,
            );
          }
          commands.set(name, { plugin: plugin.name, handler });
        }
      }
    }
    return commands;
  }

  // --- Middleware ---

  /**
   * Get an ordered list of middleware handlers from all plugins.
   * Returns handlers in plugin registration order.
   */
  getMiddleware(): MiddlewareHandler[] {
    const handlers: MiddlewareHandler[] = [];
    for (const plugin of this.#plugins) {
      if (plugin.middleware) {
        handlers.push(plugin.middleware);
      }
    }
    return handlers;
  }

  // --- Hook Dispatchers ---
  // All hooks are fire-and-forget. Errors are caught and logged.

  async firePartCreated(part: PartWithDetails): Promise<void> {
    await this.#fireHook("onPartCreated", (p) => p.onPartCreated?.(this.#ctx, part));
  }

  async firePartUpdated(part: PartWithDetails, old: Part): Promise<void> {
    await this.#fireHook("onPartUpdated", (p) => p.onPartUpdated?.(this.#ctx, part, old));
  }

  async firePartDeleted(partId: number): Promise<void> {
    await this.#fireHook("onPartDeleted", (p) => p.onPartDeleted?.(this.#ctx, partId));
  }

  async fireStockChanged(
    partId: number,
    oldStock: number,
    newStock: number,
  ): Promise<void> {
    await this.#fireHook("onStockChanged", (p) =>
      p.onStockChanged?.(this.#ctx, partId, oldStock, newStock)
    );

    // Also check for low stock and fire that hook
    if (newStock <= oldStock) {
      const part = await this.#ctx.db
        .selectFrom("parts")
        .selectAll()
        .where("id", "=", partId)
        .executeTakeFirst();

      if (part && part.stock <= part.min_stock && part.min_stock > 0) {
        // Need full PartWithDetails for the hook -- import dynamically to avoid circular dep
        const { getPart } = await import("./parts.ts");
        const fullPart = await getPart(this.#ctx.db, partId);
        if (fullPart) {
          await this.#fireHook("onLowStock", (p) => p.onLowStock?.(this.#ctx, fullPart));
        }
      }
    }
  }

  async fireBuildCompleted(buildOrder: BuildOrder): Promise<void> {
    await this.#fireHook("onBuildCompleted", (p) =>
      p.onBuildCompleted?.(this.#ctx, buildOrder)
    );
  }

  // --- Internal ---

  async #fireHook(
    hookName: string,
    fn: (plugin: TrayPlugin) => Promise<void> | undefined,
  ): Promise<void> {
    for (const plugin of this.#plugins) {
      try {
        await fn(plugin);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.#ctx.log(`[plugin] Error in '${plugin.name}.${hookName}': ${msg}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin Loader
// ---------------------------------------------------------------------------

/**
 * Load plugins from a config file path.
 * The config file is a TypeScript module that default-exports a TrayConfig.
 */
export async function loadPluginConfig(
  configPath: string,
): Promise<TrayConfig> {
  try {
    const module = await import(configPath);
    const config = module.default as TrayConfig;

    if (!config || !Array.isArray(config.plugins)) {
      return { plugins: [] };
    }

    return config;
  } catch (e) {
    // Config file doesn't exist or has errors -- that's fine, no plugins
    if (e instanceof TypeError && String(e).includes("Module not found")) {
      return { plugins: [] };
    }
    // Re-throw actual config errors so users know their config is broken
    throw new Error(`Failed to load plugin config from ${configPath}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Create a plugin engine with plugins loaded from the default config location.
 * Returns an engine with no plugins if no config file exists.
 */
export async function createPluginEngine(
  db: Kysely<Database>,
  configPath?: string,
): Promise<PluginEngine> {
  const log = (msg: string) => console.error(msg);
  const engine = new PluginEngine({ db, log });

  const path = configPath ?? getDefaultConfigPath();

  try {
    const stat = await Deno.stat(path);
    if (stat.isFile) {
      // Convert to file:// URL for dynamic import
      const fileUrl = path.startsWith("file://") ? path : `file://${path}`;
      const config = await loadPluginConfig(fileUrl);
      engine.register(config.plugins);
    }
  } catch {
    // No config file, no plugins -- that's fine
  }

  return engine;
}

function getDefaultConfigPath(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return `${home}/.tray/config.ts`;
}
