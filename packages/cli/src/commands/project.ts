/**
 * `tray project` -- Project, BOM, and Build management.
 *
 *   tray project add "Synth VCO" --description "VCO module"
 *   tray project list
 *   tray project show <id>
 *   tray project bom <id>
 *   tray project bom-add <project_id> <part> --qty 3 --refs "U1,U2,U3"
 *   tray project check <id> --qty 5
 *   tray project build <id> --qty 5
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";

const projectAddCommand = new Command()
  .name("add")
  .description("Create a new project")
  .arguments("<name:string>")
  .option("--description <desc:string>", "Project description")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, name) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api.projects.$post({
        json: { name, description: options.description },
      });
      if (!res.ok) { outputError("error", "Failed to create project", format); Deno.exit(1); }
      output(await res.json(), { format });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally { await cleanup(); }
  });

const projectListCommand = new Command()
  .name("list")
  .description("List projects")
  .alias("ls")
  .option("--status <status:string>", "Filter by status (active, archived)")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const query: Record<string, string> = {};
      if (options.status) query.status = options.status;
      const res = await client.api.projects.$get({ query });
      if (!res.ok) { outputError("error", "Failed", format); Deno.exit(1); }
      output(await res.json(), {
        format,
        columns: ["id", "name", "status", "total_line_items"],
      });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally { await cleanup(); }
  });

const projectShowCommand = new Command()
  .name("show")
  .description("Show project details and BOM")
  .arguments("<id:integer>")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, id) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api.projects[":id"].$get({ param: { id: String(id) } });
      if (!res.ok) { outputError("not_found", `Project ${id} not found`, format); Deno.exit(1); }
      const project = await res.json();
      if (format === "json") {
        output(project, { format });
      } else {
        // deno-lint-ignore no-explicit-any
        const p = project as any;
        console.log(`Project: ${p.name} [${p.status}]`);
        if (p.description) console.log(`  ${p.description}`);
        console.log(`\nBOM (${p.total_line_items} line items):`);
        if (p.bom_lines.length > 0) {
          output(p.bom_lines, {
            format: "table",
            columns: ["part_name", "quantity_required", "reference_designators", "stock_available", "sufficient"],
          });
        } else {
          console.log("  (empty)");
        }
      }
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally { await cleanup(); }
  });

const bomAddCommand = new Command()
  .name("bom-add")
  .description("Add a part to a project's BOM")
  .arguments("<project_id:integer> <part:string>")
  .option("--qty <quantity:number>", "Quantity required per unit", { required: true })
  .option("--refs <refs:string>", "Reference designators (e.g. 'R1,R2,R3')")
  .option("--notes <notes:string>", "Notes")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, projectId, partIdOrName) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

      // Resolve part
      const partRes = await client.api.parts[":id"].$get({ param: { id: partIdOrName } });
      if (!partRes.ok) { outputError("not_found", `Part '${partIdOrName}' not found`, format); Deno.exit(1); }
      const part = await partRes.json();

      const res = await client.api.projects[":id"].bom.$post({
        param: { id: String(projectId) },
        json: {
          part_id: part.id as number,
          quantity_required: options.qty,
          reference_designators: options.refs,
          notes: options.notes,
        },
      });
      if (!res.ok) {
        const err = await res.json();
        outputError("error", (err as { message?: string }).message ?? "Failed", format);
        Deno.exit(1);
      }
      output(await res.json(), { format });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally { await cleanup(); }
  });

const checkCommand = new Command()
  .name("check")
  .description("Check BOM availability for a build")
  .arguments("<project_id:integer>")
  .option("--qty <quantity:integer>", "Number of units to build", { default: 1 })
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, projectId) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api.projects[":id"].check.$get({
        param: { id: String(projectId) },
        query: { quantity: String(options.qty) },
      });
      if (!res.ok) { outputError("error", "Failed", format); Deno.exit(1); }
      const result = await res.json();
      if (format === "json") {
        output(result, { format });
      } else {
        // deno-lint-ignore no-explicit-any
        const r = result as any;
        if (r.can_build) {
          console.log(`Can build ${options.qty} unit(s): YES`);
        } else {
          console.log(`Can build ${options.qty} unit(s): NO`);
          console.log("\nShortages:");
          output(r.shortages, { format: "table", columns: ["part_name", "required", "available", "short"] });
        }
      }
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally { await cleanup(); }
  });

const buildCommand = new Command()
  .name("build")
  .description("Create and optionally complete a build order")
  .arguments("<project_id:integer>")
  .option("--qty <quantity:integer>", "Number of units to build", { default: 1 })
  .option("--complete", "Immediately complete the build (deduct stock)")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, projectId) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

      // Create build order
      const createRes = await client.api.builds.$post({
        json: { project_id: projectId, quantity: options.qty },
      });
      if (!createRes.ok) {
        const err = await createRes.json();
        outputError("error", (err as { message?: string }).message ?? "Failed", format);
        Deno.exit(1);
      }
      const build = await createRes.json();

      if (options.complete) {
        // Complete the build
        const completeRes = await client.api.builds[":id"].complete.$post({
          param: { id: String((build as { id: number }).id) },
        });
        if (!completeRes.ok) {
          const err = await completeRes.json();
          outputError("build_error", (err as { message?: string }).message ?? "Failed to complete", format);
          Deno.exit(1);
        }
        output(await completeRes.json(), { format });
      } else {
        output(build, { format });
      }
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally { await cleanup(); }
  });

export const projectCommand = new Command()
  .name("project")
  .description("Project and BOM management")
  .command("add", projectAddCommand)
  .command("list", projectListCommand)
  .command("show", projectShowCommand)
  .command("bom-add", bomAddCommand)
  .command("check", checkCommand)
  .command("build", buildCommand);
