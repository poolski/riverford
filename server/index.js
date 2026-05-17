import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./http.js";
import { createRecipeService } from "./service.js";
import { createRecipeStore } from "./store.js";

const PORT = Number(process.env.PORT ?? 3001);
const DATA_DIR = process.env.DATA_DIR ?? "data";
const store = createRecipeStore(`${DATA_DIR}/recipes.sqlite`);

export async function fetchText(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.text();
}

const distDir = join(import.meta.dirname, "../dist");
const staticDir = existsSync(distDir) ? distDir : undefined;

const service = createRecipeService({ store, fetchText });
const app = createApp(service, { staticDir });

const server = app.listen(PORT, () => {
  console.log(`Riverford recipes listening on http://localhost:${PORT}`);
  if (staticDir) console.log("Serving frontend from", staticDir);
});

function shutdown() {
  console.log("Shutting down…");
  server.close(() => {
    store.close();
    process.exit(0);
  });
  // Force exit if connections don't drain within 10 s.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
