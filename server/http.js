import cors from "cors";
import express from "express";

export function createApp(service, { staticDir } = {}) {
  const app = express();

  if (!staticDir) {
    // Dev: allow cross-origin requests from the Vite dev server.
    app.use(cors());
  }

  app.get("/api/recipes", createRecipesHandler(service));
  app.get("/api/recipes/status", createStatusHandler(service));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  if (staticDir) {
    app.use(express.static(staticDir));
    // SPA fallback: serve index.html for any non-API route.
    app.get("/{*path}", (_req, res) =>
      res.sendFile("index.html", { root: staticDir })
    );
  }

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export function createStatusHandler(service) {
  return (_request, response) => {
    queueMicrotask(() => {
      void service.refreshRecipes();
      void service.enrichPendingRecipes();
    });
    response.json(service.getStatus());
  };
}

export function createRecipesHandler(service) {
  return async (request, response, next) => {
    try {
      await service.refreshRecipes();
      const payload = service.listRecipes(parseRecipeFilters(request));
      queueMicrotask(() => {
        void service.enrichPendingRecipes();
      });
      response.json(payload);
    } catch (err) {
      next(err);
    }
  };
}

function parseRecipeFilters(request) {
  return {
    terms: request.query?.q
      ? String(request.query.q)
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    category: request.query?.category
  };
}
