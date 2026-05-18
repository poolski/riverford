import { describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import {
  createApp,
  createRecipesHandler,
  createRefreshHandler,
  createSaveRecipeHandler,
  createSavedRecipesListHandler,
  createUnsaveRecipeHandler,
  createStatusHandler
} from "./http.js";

function makeService(overrides = {}) {
  return {
    refreshRecipes: vi.fn().mockResolvedValue({ usedCache: false, total: 0 }),
    requestRecipeRefresh: vi
      .fn()
      .mockResolvedValue({ usedCache: false, total: 0, enriched: 0 }),
    enrichPendingRecipes: vi.fn().mockResolvedValue(undefined),
    listRecipes: vi.fn().mockReturnValue({ usedCache: false, total: 0, enriched: 0, recipes: [] }),
    getStatus: vi.fn().mockReturnValue({ usedCache: false, total: 0, enriched: 0 }),
    listSavedRecipes: vi.fn().mockReturnValue({ savedRecipeIds: [] }),
    saveRecipe: vi.fn().mockResolvedValue({ savedRecipeIds: [1] }),
    unsaveRecipe: vi.fn().mockResolvedValue({ savedRecipeIds: [] }),
    ...overrides
  };
}

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const app = createApp(makeService());
    await supertest(app).get("/health").expect(200, { status: "ok" });
  });
});

describe("404 handler", () => {
  it("returns 404 json for unknown routes", async () => {
    const app = createApp(makeService());
    const res = await supertest(app).get("/not-a-route").expect(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

describe("error middleware", () => {
  it("returns 500 when a handler throws", async () => {
    const service = makeService({
      refreshRecipes: vi.fn().mockRejectedValue(new Error("boom"))
    });
    const app = createApp(service);
    const res = await supertest(app).get("/api/recipes?q=test").expect(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});

describe("CORS", () => {
  it("allows cross-origin requests when no staticDir is set (dev mode)", async () => {
    const app = createApp(makeService());
    const res = await supertest(app)
      .get("/health")
      .set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBeTruthy();
  });

  it("omits CORS headers when staticDir is set (production mode)", async () => {
    const app = createApp(makeService(), { staticDir: "/nonexistent-but-doesnt-matter" });
    const res = await supertest(app)
      .get("/health")
      .set("Origin", "http://attacker.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("http api", () => {
  it("returns recipe data without waiting for enrichment", async () => {
    const service = {
      refreshRecipes: vi.fn().mockResolvedValue({ usedCache: false, total: 1 }),
      enrichPendingRecipes: vi.fn().mockResolvedValue(undefined),
      listRecipes: vi.fn().mockReturnValue({
        usedCache: false,
        total: 1,
        enriched: 0,
        recipes: [
          {
            id: 1,
            title: "Aglio Olio",
            categories: [],
            enrichmentStatus: "pending"
          }
        ]
      })
    };

    const json = vi.fn();
    await createRecipesHandler(service)({ query: { q: "olio" } }, { json });

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        recipes: [
          expect.objectContaining({
            title: "Aglio Olio",
            enrichmentStatus: "pending"
          })
        ]
      })
    );
    expect(service.enrichPendingRecipes).toHaveBeenCalled();
    expect(service.listRecipes).toHaveBeenCalledWith({
      terms: ["olio"],
      category: undefined
    });
  });

  it("keeps status responses unfiltered even when query params are present", async () => {
    const service = {
      enrichPendingRecipes: vi.fn().mockResolvedValue(undefined),
      refreshRecipes: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({
        usedCache: false,
        total: 2,
        enriched: 1
      })
    };

    const json = vi.fn();
    createStatusHandler(service)(
      { query: { title: "pasta", ingredients: "cheese" } },
      { json }
    );

    expect(service.getStatus).toHaveBeenCalledWith();
    expect(json).toHaveBeenCalledWith({
      usedCache: false,
      total: 2,
      enriched: 1
    });
  });

  it("passes force=true to refresh when status query includes force flag", async () => {
    const service = {
      enrichPendingRecipes: vi.fn().mockResolvedValue(undefined),
      refreshRecipes: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ usedCache: false, total: 1, enriched: 0 })
    };

    const json = vi.fn();
    createStatusHandler(service)({ query: { force: "1" } }, { json });
    await Promise.resolve();

    expect(service.refreshRecipes).toHaveBeenCalledWith({ force: true });
  });

  it("status handler triggers a background refresh", async () => {
    const service = {
      enrichPendingRecipes: vi.fn().mockResolvedValue(undefined),
      refreshRecipes: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ usedCache: false, total: 1, enriched: 0 })
    };

    const json = vi.fn();
    createStatusHandler(service)({}, { json });
    await Promise.resolve(); // flush microtask queue

    expect(service.refreshRecipes).toHaveBeenCalledWith({ force: false });
  });

  it("refresh handler accepts selected URLs and triggers targeted refresh", async () => {
    const service = {
      refreshRecipes: vi.fn().mockResolvedValue(undefined),
      requestRecipeRefresh: vi
        .fn()
        .mockResolvedValue({ usedCache: false, total: 3, enriched: 1 }),
      enrichPendingRecipes: vi.fn().mockResolvedValue(undefined)
    };

    const json = vi.fn();
    const next = vi.fn();
    await createRefreshHandler(service)(
      {
        body: {
          force: true,
          urls: ["https://www.riverford.co.uk/recipes/a", 123, null]
        }
      },
      { json },
      next
    );
    await Promise.resolve();

    expect(service.refreshRecipes).toHaveBeenCalledWith({ force: true });
    expect(service.requestRecipeRefresh).toHaveBeenCalledWith({
      force: true,
      urls: ["https://www.riverford.co.uk/recipes/a"]
    });
    expect(
      service.refreshRecipes.mock.invocationCallOrder[0]
    ).toBeLessThan(service.requestRecipeRefresh.mock.invocationCallOrder[0]);
    expect(service.enrichPendingRecipes).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({
      usedCache: false,
      total: 3,
      enriched: 1
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("lists saved recipes", async () => {
    const service = makeService({
      listSavedRecipes: vi.fn().mockReturnValue({ savedRecipeIds: [1, 2] })
    });
    const json = vi.fn();
    createSavedRecipesListHandler(service)({}, { json });

    expect(json).toHaveBeenCalledWith({ savedRecipeIds: [1, 2] });
  });

  it("saves a recipe by recipeId", async () => {
    const service = makeService({
      saveRecipe: vi.fn().mockResolvedValue({ savedRecipeIds: [3] })
    });
    const json = vi.fn();
    const next = vi.fn();

    await createSaveRecipeHandler(service)(
      { body: { recipeId: "3" } },
      { json },
      next
    );

    expect(service.saveRecipe).toHaveBeenCalledWith(3);
    expect(json).toHaveBeenCalledWith({ savedRecipeIds: [3] });
    expect(next).not.toHaveBeenCalled();
  });

  it("unsaves a recipe by recipeId", async () => {
    const service = makeService({
      unsaveRecipe: vi.fn().mockResolvedValue({ savedRecipeIds: [] })
    });
    const json = vi.fn();
    const next = vi.fn();

    await createUnsaveRecipeHandler(service)(
      { params: { recipeId: "3" } },
      { json },
      next
    );

    expect(service.unsaveRecipe).toHaveBeenCalledWith(3);
    expect(json).toHaveBeenCalledWith({ savedRecipeIds: [] });
    expect(next).not.toHaveBeenCalled();
  });
});
