# Installation

## Binary Download (Recommended)

Download the pre-compiled binary for your platform from [GitHub Releases](https://github.com/willwillems/tray/releases).

```bash
# macOS Apple Silicon
curl -L https://github.com/willwillems/tray/releases/latest/download/tray-darwin-arm64 \
  -o /usr/local/bin/tray && chmod +x /usr/local/bin/tray

# Verify
tray --version
```

The binary is self-contained (~75MB). No runtime dependencies.

## Build from Source

Requires [Deno](https://deno.land) v2+.

```bash
git clone https://github.com/willwillems/tray.git
cd tray

# Run tests (216 tests, ~1 second)
deno task test

# Compile
deno compile -A --output ~/.tray/bin/tray packages/cli/src/mod.ts

# Add to PATH (add to your .zshrc / .bashrc)
export PATH="$HOME/.tray/bin:$PATH"
```

## Run without Installing

If you have Deno installed, you can run directly from source without compiling:

```bash
deno run -A packages/cli/src/mod.ts add "NE555" --stock 25
```

Or install a shim script:

```bash
deno install -gAf --name tray packages/cli/src/mod.ts
```

This puts a `tray` shim in `~/.deno/bin/` that invokes Deno at runtime. Slightly slower startup (~200ms vs ~50ms compiled) but no compilation step.

## Data Location

Tray stores data in `~/.tray/`:

```
~/.tray/
  data.db           # SQLite database
  attachments/      # Attached files (content-addressed)
    ab/
      ab3f...a1.pdf
```

Override the database path with the `TRAY_DB` environment variable:

```bash
export TRAY_DB=/path/to/my/inventory.db
tray list
```

Or per-command with `--db`:

```bash
tray list --db /path/to/inventory.db
```
