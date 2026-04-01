# Plugins

Tray has a TypeScript plugin system inspired by Vite. Plugins can add custom CLI commands and hook into lifecycle events like part creation, stock changes, and build completions.

Plugins are registered in a TypeScript config file. They run in-process with full access to the database. Hook errors are caught and logged -- a buggy plugin never crashes Tray.

## Quick Start

### 1. Create a Plugin

```ts
// ~/.tray/plugins/logger.ts
import type { TrayPlugin } from "@tray/core";

export default function logger(): TrayPlugin {
  return {
    name: "logger",

    onPartCreated: async (ctx, part) => {
      ctx.log(`[logger] Part created: ${part.name} (stock: ${part.stock})`);
    },

    onStockChanged: async (ctx, partId, oldStock, newStock) => {
      ctx.log(`[logger] Stock changed for part #${partId}: ${oldStock} -> ${newStock}`);
    },

    onLowStock: async (ctx, part) => {
      ctx.log(`[logger] LOW STOCK: ${part.name} has ${part.stock}, min is ${part.min_stock}`);
    },
  };
}
```

### 2. Register in Config

```ts
// ~/.tray/config.ts
import type { TrayConfig } from "@tray/core";
import logger from "./plugins/logger.ts";

export default {
  plugins: [
    logger(),
  ],
} satisfies TrayConfig;
```

### 3. Use Tray Normally

Plugins activate automatically. When you add a part, the logger fires:

```bash
tray add "NE555" --stock 25
# [logger] Part created: NE555 (stock: 25)
```

## Plugin Interface

```ts
interface TrayPlugin {
  name: string;
  commands?: Record<string, CommandHandler>;
  onPartCreated?:    (ctx: PluginContext, part: PartWithDetails) => Promise<void>;
  onPartUpdated?:    (ctx: PluginContext, part: PartWithDetails, old: Part) => Promise<void>;
  onPartDeleted?:    (ctx: PluginContext, partId: number) => Promise<void>;
  onStockChanged?:   (ctx: PluginContext, partId: number, oldStock: number, newStock: number) => Promise<void>;
  onLowStock?:       (ctx: PluginContext, part: PartWithDetails) => Promise<void>;
  onBuildCompleted?: (ctx: PluginContext, buildOrder: BuildOrder) => Promise<void>;
}
```

All hooks are optional. Implement only what you need.

## Plugin Context

Every hook and command receives a `PluginContext`:

```ts
interface PluginContext {
  db: Kysely<Database>;          // Direct database access (read/write)
  log: (message: string) => void; // Log output visible to the user
}
```

The `db` field gives you full Kysely query access to the Tray database. You can read any table, insert data, run raw SQL -- anything the core can do.

## Custom Commands

Plugins can register CLI commands:

```ts
export default function digikey(config: { apiKey: string }): TrayPlugin {
  return {
    name: "digikey",

    commands: {
      "digikey-search": async (ctx, args) => {
        const query = args.join(" ");
        const response = await fetch(
          `https://api.digikey.com/Search/v3/Products/Keyword?keywords=${query}`,
          { headers: { "X-IBMM-Client-Id": config.apiKey } },
        );
        const data = await response.json();
        ctx.log(JSON.stringify(data, null, 2));
      },

      "digikey-import": async (ctx, args) => {
        const partNumber = args[0];
        // Fetch part data from DigiKey, add to inventory
        // ...
      },
    },
  };
}
```

Usage:

```bash
tray digikey-search "NE555"
tray digikey-import "296-1411-5-ND"
```

## Lifecycle Hooks

### `onPartCreated`

Fired after a part is created. Receives the full `PartWithDetails` (includes tags, category path, parameters).

Use cases: auto-enrich with manufacturer data, assign default category, send notification.

### `onPartUpdated`

Fired after a part is updated. Receives both the new state and a snapshot of the old state.

Use cases: sync changes to external system, log field-level diffs.

### `onPartDeleted`

Fired after a part is deleted. Receives the part ID (the part itself no longer exists in the database).

Use cases: clean up external references, log deletion.

### `onStockChanged`

Fired when a part's stock level changes (after any lot insert/update/delete). Receives the part ID, old stock, and new stock.

Use cases: real-time dashboard updates, integration with external systems.

### `onLowStock`

Fired automatically when `onStockChanged` detects that stock has dropped to or below `min_stock`. Only fires when stock is decreasing (not when stock increases through a threshold).

Use cases: Slack/email alerts, auto-generate purchase order, trigger reorder script.

### `onBuildCompleted`

Fired after a build order is marked complete and stock has been deducted.

Use cases: notify team, update project tracker, generate build report.

## Error Handling

Plugin errors are **caught and logged**, never propagated. A crashing plugin cannot break Tray:

```ts
{
  name: "buggy",
  onPartCreated: async () => {
    throw new Error("oops!");
    // This is logged as: [plugin] Error in 'buggy.onPartCreated': oops!
    // Other plugins and the main operation continue normally.
  },
}
```

Multiple plugins with errors don't stop each other. If plugins A, B, and C all have `onPartCreated` hooks, and B throws, A and C still run.

## Configuration Patterns

### Passing Secrets

Use environment variables, not hardcoded strings:

```ts
export default {
  plugins: [
    digikey({ apiKey: Deno.env.get("DIGIKEY_API_KEY")! }),
    slack({ webhook: Deno.env.get("SLACK_WEBHOOK")! }),
  ],
} satisfies TrayConfig;
```

### Conditional Plugins

```ts
const plugins: TrayPlugin[] = [
  logger(),
];

if (Deno.env.get("DIGIKEY_API_KEY")) {
  plugins.push(digikey({ apiKey: Deno.env.get("DIGIKEY_API_KEY")! }));
}

export default { plugins } satisfies TrayConfig;
```

### Plugin Composition

Plugins are just objects. You can combine them:

```ts
function allNotifications(config: { slack?: string; email?: string }): TrayPlugin {
  return {
    name: "notifications",
    onLowStock: async (ctx, part) => {
      if (config.slack) {
        await fetch(config.slack, {
          method: "POST",
          body: JSON.stringify({ text: `Low stock: ${part.name} (${part.stock} left)` }),
        });
      }
      if (config.email) {
        // send email...
      }
    },
  };
}
```

## Example: Slack Low Stock Alert

```ts
// ~/.tray/plugins/slack-alert.ts
import type { TrayPlugin } from "@tray/core";

export default function slackAlert(webhookUrl: string): TrayPlugin {
  return {
    name: "slack-alert",

    onLowStock: async (ctx, part) => {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `:warning: Low stock alert: *${part.name}* has ${part.stock} units (minimum: ${part.min_stock})`,
        }),
      });
      ctx.log(`[slack] Alert sent for ${part.name}`);
    },
  };
}
```
