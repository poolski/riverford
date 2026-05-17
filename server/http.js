import cors from "cors";
import express from "express";

export function createApp(service) {
  const app = express();
  app.use(cors());

  app.get("/api/recipes", createRecipesHandler(service));

  app.get("/api/recipes/status", createStatusHandler(service));

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
  return async (request, response) => {
    await service.refreshRecipes();
    const payload = service.listRecipes(parseRecipeFilters(request));
    queueMicrotask(() => {
      void service.enrichPendingRecipes();
    });
    response.json(payload);
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
