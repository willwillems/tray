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
import { withClient, resolvePart } from "../client.ts";
import { output, assertOk } from "../output/format.ts";

const projectAddCommand = new Command()
  .name("add")
  .description("Create a new project")
  .arguments("<name:string>")
  .option("--description <desc:string>", "Project description")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, name) => {
    await withClient(options.db, async (client) => {
      const res = await client.api.projects.$post({
        json: { name, description: options.description },
      });
      await assertOk(res, "error", "Failed to create project");
      output(await res.json(), { format: options.format });
    });
  });

const projectListCommand = new Command()
  .name("list")
  .description("List projects")
  .alias("ls")
  .option("--status <status:string>", "Filter by status (active, archived)")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options) => {
    await withClient(options.db, async (client) => {
      const query: Record<string, string> = {};
      if (options.status) query.status = options.status;
      const res = await client.api.projects.$get({ query });
      await assertOk(res, "error", "Failed to list projects");
      output(await res.json(), {
        format: options.format,
        columns: ["id", "name", "status", "total_line_items"],
      });
    });
  });

const projectShowCommand = new Command()
  .name("show")
  .description("Show project details and BOM")
  .arguments("<id:integer>")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, id) => {
    await withClient(options.db, async (client) => {
      const res = await client.api.projects[":id"].$get({ param: { id: String(id) } });
      await assertOk(res, "not_found", `Project ${id} not found`);
      const project = await res.json();
      if (options.format === "json") {
        output(project, { format: options.format });
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
    });
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
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, partIdOrName);

      const res = await client.api.projects[":id"].bom.$post({
        param: { id: String(projectId) },
        json: {
          part_id: part.id as number,
          quantity_required: options.qty,
          reference_designators: options.refs,
          notes: options.notes,
        },
      });
      await assertOk(res, "error", "Failed to add BOM line");
      output(await res.json(), { format: options.format });
    });
  });

const checkCommand = new Command()
  .name("check")
  .description("Check BOM availability for a build")
  .arguments("<project_id:integer>")
  .option("--qty <quantity:integer>", "Number of units to build", { default: 1 })
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, projectId) => {
    await withClient(options.db, async (client) => {
      const res = await client.api.projects[":id"].check.$get({
        param: { id: String(projectId) },
        query: { quantity: String(options.qty) },
      });
      await assertOk(res, "error", "Failed to check availability");
      const result = await res.json();
      if (options.format === "json") {
        output(result, { format: options.format });
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
    });
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
    await withClient(options.db, async (client) => {
      // Create build order
      const createRes = await client.api.builds.$post({
        json: { project_id: projectId, quantity: options.qty },
      });
      await assertOk(createRes, "error", "Failed to create build order");
      const build = await createRes.json();

      if (options.complete) {
        // Complete the build
        const completeRes = await client.api.builds[":id"].complete.$post({
          param: { id: String((build as { id: number }).id) },
        });
        await assertOk(completeRes, "build_error", "Failed to complete build");
        output(await completeRes.json(), { format: options.format });
      } else {
        output(build, { format: options.format });
      }
    });
  });

export const projectCommand = new Command()
  .name("project")
  .description("Project and BOM management")
  .example("Create a project", "tray project add 'Synth VCO' --description 'VCO module'")
  .example("Add part to BOM", "tray project bom-add 1 NE555 --qty 3 --refs 'U1,U2,U3'")
  .example("Check build feasibility", "tray project check 1 --qty 5")
  .example("Build and deduct stock", "tray project build 1 --qty 2 --complete")
  .command("add", projectAddCommand)
  .command("list", projectListCommand)
  .command("show", projectShowCommand)
  .command("bom-add", bomAddCommand)
  .command("check", checkCommand)
  .command("build", buildCommand);
