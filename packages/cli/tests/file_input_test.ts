/**
 * Unit tests for the shared file-input helper (resolveFileInput, guessMimeType,
 * warnIfUnsupportedImageFormat).
 */

import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { resolveFileInput, guessMimeType, warnIfUnsupportedImageFormat } from "../src/file-input.ts";

// --- resolveFileInput: local files ---

Deno.test("resolveFileInput - reads local file", async () => {
  const tmp = Deno.makeTempFileSync({ suffix: ".txt" });
  Deno.writeTextFileSync(tmp, "hello world");

  const result = await resolveFileInput(tmp);
  assertEquals(new TextDecoder().decode(result.data), "hello world");
  assertEquals(result.mimeType, "text/plain");
  assertEquals(result.sourceUrl, undefined);
  assertStringIncludes(result.filename, ".txt");

  Deno.removeSync(tmp);
});

Deno.test("resolveFileInput - throws for missing local file", async () => {
  await assertRejects(
    () => resolveFileInput("/nonexistent/path/file.txt"),
    Error,
    "Cannot read file",
  );
});

// --- resolveFileInput: URLs ---

Deno.test("resolveFileInput - fetches URL", async () => {
  // Spin up a tiny HTTP server
  const content = new TextEncoder().encode("remote file content");
  const server = Deno.serve({ port: 0, onListen: () => {} }, (_req) => {
    return new Response(content, {
      headers: { "Content-Type": "image/png" },
    });
  });
  const port = server.addr.port;

  try {
    const result = await resolveFileInput(`http://localhost:${port}/photo.png`);
    assertEquals(new TextDecoder().decode(result.data), "remote file content");
    assertEquals(result.mimeType, "image/png");
    assertEquals(result.sourceUrl, `http://localhost:${port}/photo.png`);
    assertEquals(result.filename, "photo.png");
  } finally {
    await server.shutdown();
  }
});

Deno.test("resolveFileInput - uses Content-Type from response headers", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, (_req) => {
    return new Response("data", {
      headers: { "Content-Type": "image/webp; charset=utf-8" },
    });
  });
  const port = server.addr.port;

  try {
    const result = await resolveFileInput(`http://localhost:${port}/img`);
    // Should strip charset parameter
    assertEquals(result.mimeType, "image/webp");
  } finally {
    await server.shutdown();
  }
});

Deno.test("resolveFileInput - falls back to extension-based MIME when Content-Type is generic", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, (_req) => {
    return new Response("data", {
      headers: { "Content-Type": "application/octet-stream" },
    });
  });
  const port = server.addr.port;

  try {
    const result = await resolveFileInput(`http://localhost:${port}/image.jpg`);
    // When server returns octet-stream, we fall back to extension-based guess
    assertEquals(result.mimeType, "image/jpeg");
    assertEquals(result.filename, "image.jpg");
  } finally {
    await server.shutdown();
  }
});

Deno.test({
  name: "resolveFileInput - throws on HTTP error",
  // The fetch error path cancels the response body, but Deno's leak detector
  // can still flag it briefly. Allow resource cleanup.
  sanitizeResources: false,
  fn: async () => {
    const server = Deno.serve({ port: 0, onListen: () => {} }, (_req) => {
      return new Response("not found", { status: 404 });
    });
    const port = server.addr.port;

    try {
      await assertRejects(
        () => resolveFileInput(`http://localhost:${port}/missing.jpg`),
        Error,
        "HTTP 404",
      );
    } finally {
      await server.shutdown();
    }
  },
});

Deno.test("resolveFileInput - extracts filename from URL path", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, (_req) => {
    return new Response("data", { headers: { "Content-Type": "image/jpeg" } });
  });
  const port = server.addr.port;

  try {
    const result = await resolveFileInput(
      `http://localhost:${port}/products/kf/S4649f43.jpg`,
    );
    assertEquals(result.filename, "S4649f43.jpg");
  } finally {
    await server.shutdown();
  }
});

// --- guessMimeType ---

Deno.test("guessMimeType - known extensions", () => {
  assertEquals(guessMimeType("photo.png"), "image/png");
  assertEquals(guessMimeType("photo.jpg"), "image/jpeg");
  assertEquals(guessMimeType("photo.jpeg"), "image/jpeg");
  assertEquals(guessMimeType("photo.gif"), "image/gif");
  assertEquals(guessMimeType("photo.webp"), "image/webp");
  assertEquals(guessMimeType("photo.bmp"), "image/bmp");
  assertEquals(guessMimeType("photo.avif"), "image/avif");
  assertEquals(guessMimeType("photo.heic"), "image/heic");
  assertEquals(guessMimeType("photo.svg"), "image/svg+xml");
  assertEquals(guessMimeType("doc.pdf"), "application/pdf");
  assertEquals(guessMimeType("board.kicad_pcb"), "application/x-kicad-pcb");
});

Deno.test("guessMimeType - unknown extension falls back", () => {
  assertEquals(guessMimeType("file.xyz"), "application/octet-stream");
  assertEquals(guessMimeType("noext"), "application/octet-stream");
});

// --- warnIfUnsupportedImageFormat ---

Deno.test("warnIfUnsupportedImageFormat - no warning for supported formats", () => {
  // Capture stderr
  const original = console.error;
  const messages: string[] = [];
  console.error = (msg: string) => messages.push(msg);

  try {
    warnIfUnsupportedImageFormat("image/png", "photo.png");
    warnIfUnsupportedImageFormat("image/jpeg", "photo.jpg");
    warnIfUnsupportedImageFormat("image/gif", "photo.gif");
    warnIfUnsupportedImageFormat("image/bmp", "photo.bmp");
    assertEquals(messages.length, 0);
  } finally {
    console.error = original;
  }
});

Deno.test("warnIfUnsupportedImageFormat - warns for unsupported image formats", () => {
  const original = console.error;
  const messages: string[] = [];
  console.error = (msg: string) => messages.push(msg);

  try {
    warnIfUnsupportedImageFormat("image/avif", "photo.avif");
    assertEquals(messages.length, 1);
    assertStringIncludes(messages[0], ".avif");
    assertStringIncludes(messages[0], "not supported for thumbnail");

    warnIfUnsupportedImageFormat("image/heic", "photo.heic");
    assertEquals(messages.length, 2);

    warnIfUnsupportedImageFormat("image/tiff", "photo.tiff");
    assertEquals(messages.length, 3);

    warnIfUnsupportedImageFormat("image/svg+xml", "icon.svg");
    assertEquals(messages.length, 4);
  } finally {
    console.error = original;
  }
});

Deno.test("warnIfUnsupportedImageFormat - no warning for non-image types", () => {
  const original = console.error;
  const messages: string[] = [];
  console.error = (msg: string) => messages.push(msg);

  try {
    warnIfUnsupportedImageFormat("application/pdf", "doc.pdf");
    warnIfUnsupportedImageFormat("text/plain", "notes.txt");
    assertEquals(messages.length, 0);
  } finally {
    console.error = original;
  }
});
