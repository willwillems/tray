/**
 * Version bump script for Tray.
 *
 * Usage:
 *   deno task version:bump patch    # 0.1.0 -> 0.1.1
 *   deno task version:bump minor    # 0.1.0 -> 0.2.0
 *   deno task version:bump major    # 0.1.0 -> 1.0.0
 *   deno task version:bump 2.0.0    # explicit version
 *
 * Updates all version references and creates a git commit + tag.
 */

const DENO_JSON_PATHS = [
  "deno.json",
  "packages/core/deno.json",
  "packages/api/deno.json",
  "packages/cli/deno.json",
];

const SKILL_PATH = "skills/tray/SKILL.md";

function bumpSemver(
  current: string,
  kind: "patch" | "minor" | "major",
): string {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (kind) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

function resolveVersion(current: string, arg: string): string {
  if (arg === "patch" || arg === "minor" || arg === "major") {
    return bumpSemver(current, arg);
  }
  if (/^\d+\.\d+\.\d+$/.test(arg)) {
    return arg;
  }
  console.error(
    `Invalid argument: "${arg}". Use patch, minor, major, or an explicit semver (e.g. 2.0.0).`,
  );
  Deno.exit(1);
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(path));
}

async function writeJson(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2) + "\n");
}

async function updateSkillFrontmatter(
  path: string,
  newVersion: string,
): Promise<void> {
  const text = await Deno.readTextFile(path);
  const updated = text.replace(
    /^(\s*version:\s*)"[^"]*"/m,
    `$1"${newVersion}"`,
  );
  await Deno.writeTextFile(path, updated);
}

async function main() {
  const arg = Deno.args[0];
  if (!arg) {
    console.error(
      "Usage: deno task version:bump <patch|minor|major|x.y.z>",
    );
    Deno.exit(1);
  }

  // Read current version from root deno.json
  const root = await readJson("deno.json");
  const current = root.version as string;
  if (!current) {
    console.error('No "version" field found in root deno.json');
    Deno.exit(1);
  }

  const next = resolveVersion(current, arg);
  console.log(`${current} -> ${next}`);

  // Update all deno.json files
  for (const path of DENO_JSON_PATHS) {
    const json = await readJson(path);
    json.version = next;
    await writeJson(path, json);
    console.log(`  updated ${path}`);
  }

  // Update skill frontmatter
  await updateSkillFrontmatter(SKILL_PATH, next);
  console.log(`  updated ${SKILL_PATH}`);

  // Git commit + tag
  const gitAdd = new Deno.Command("git", {
    args: ["add", ...DENO_JSON_PATHS, SKILL_PATH],
  });
  await gitAdd.output();

  const gitCommit = new Deno.Command("git", {
    args: ["commit", "-m", `v${next}`],
  });
  await gitCommit.output();

  const gitTag = new Deno.Command("git", {
    args: ["tag", `v${next}`],
  });
  await gitTag.output();

  console.log(`\nCommitted and tagged v${next}`);
  console.log(`Run "git push --tags" to publish.`);
}

main();
