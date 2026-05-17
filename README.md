# Riverford Recipe Browser

Search Riverford's full recipe archive by name or ingredient. The app loads every recipe URL from Riverford's sitemap, enriches each one with metadata (cook time, servings, categories, ingredients) in the background, and caches everything in SQLite between runs.

## Features

- Unified search — type a name, ingredient, or comma-separated list to match across both
- Fuzzy ingredient matching: "chicken" matches "chicken breast", but not "sweet potato"
- Results ranked by how many of your search terms match ingredients
- Progressive enrichment — recipes appear immediately, metadata fills in over time
- SQLite cache survives restarts; falls back to cache if Riverford is unavailable

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/api` to the Express backend on `:3001`.

## Running in production

```bash
npm install
npm run build   # builds the React frontend into dist/
npm start       # serves both the API and the frontend on $PORT (default 3001)
```

Environment variables:

| Variable   | Default | Description                            |
|------------|---------|----------------------------------------|
| `PORT`     | `3001`  | Port the server listens on             |
| `DATA_DIR` | `data`  | Directory where `recipes.sqlite` lives |

## Running with Docker

The quickest way to get a self-contained, persistent instance:

```bash
docker compose up
```

This builds the image, starts the server on port 3001, and mounts a named volume for the SQLite database so recipe metadata survives container restarts.

See [docker-compose.yml](docker-compose.yml) for configuration options.

## Development

| Command              | Description                              |
|----------------------|------------------------------------------|
| `npm run dev`        | Vite + Express with hot reload           |
| `npm test`           | Run the full test suite (Vitest)         |
| `npm run test:watch` | Re-run tests on file changes             |
| `npm run build`      | Production frontend bundle               |
| `npm start`          | Production server (requires built dist/) |

## Architecture

```text
browser
  │
  ├── GET /           → dist/index.html  (React SPA)
  ├── GET /api/recipes/status  → status + background refresh trigger
  └── GET /api/recipes?q=…     → filtered, ranked recipe list
                                              │
                                    server/service.js
                                              │
                            ┌─────────────────┴──────────────────┐
                    sitemap fetch                         per-recipe fetch
                 (Riverford XML, TTL 5 min)         (enrichment, background)
                            │                                     │
                       store.upsertRecipes()            store.updateMetadata()
                                              │
                                    data/recipes.sqlite
```

**Polling strategy:** the client polls `/api/recipes/status` every 500 ms until the recipe count is non-zero, then backs off to every 3 seconds. This means the count appears within ~500 ms of the sitemap loading rather than waiting for the next fixed tick.

## Health check

`GET /health` returns `{"status":"ok"}` — suitable for Docker health checks and load balancer probes.
