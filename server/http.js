import cors from "cors";
import express from "express";

export function createApp(service, { staticDir } = {}) {
  const app = express();
  app.use(express.json());

  if (!staticDir) {
    // Dev: allow cross-origin requests from the Vite dev server.
    app.use(cors());
  }

  app.get("/api/recipes", createRecipesHandler(service));
  app.get("/api/recipes/status", createStatusHandler(service));
  app.post("/api/recipes/refresh", createRefreshHandler(service));
  app.get("/api/saved-recipes", createSavedRecipesListHandler(service));
  app.post("/api/saved-recipes", createSaveRecipeHandler(service));
  app.delete("/api/saved-recipes/:recipeId", createUnsaveRecipeHandler(service));
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
  return (request, response) => {
    const force = parseForceParam(request.query?.force);
    queueMicrotask(() => {
      void service.refreshRecipes({ force });
      void service.enrichPendingRecipes();
    });
    response.json(service.getStatus());
  };
}

export function createRecipesHandler(service) {
  return async (request, response, next) => {
    try {
      const force = parseForceParam(request.query?.force);
      await service.refreshRecipes({ force });
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

export function createRefreshHandler(service) {
  return async (request, response, next) => {
    try {
      const force = parseForceParam(request.body?.force);
      const urls = Array.isArray(request.body?.urls)
        ? request.body.urls.filter((url) => typeof url === "string")
        : [];
      await service.refreshRecipes({ force });
      const status = await service.requestRecipeRefresh({ urls, force });
      queueMicrotask(() => {
        void service.enrichPendingRecipes();
      });
      response.json(status);
    } catch (err) {
      next(err);
    }
  };
}

export function createSavedRecipesListHandler(service) {
  return (_request, response) => {
    response.json(service.listSavedRecipes());
  };
}

export function createSaveRecipeHandler(service) {
  return async (request, response, next) => {
    try {
      const recipeId = parseRecipeId(request.body?.recipeId);
      response.json(await service.saveRecipe(recipeId));
    } catch (err) {
      next(err);
    }
  };
}

export function createUnsaveRecipeHandler(service) {
  return async (request, response, next) => {
    try {
      const recipeId = parseRecipeId(request.params?.recipeId);
      response.json(await service.unsaveRecipe(recipeId));
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

function parseForceParam(value) {
  if (value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseRecipeId(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid recipeId");
  }
  return parsed;
}
