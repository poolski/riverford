import { describe, expect, it, vi } from "vitest";
import { createRecipesHandler, createStatusHandler } from "./http.js";

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
});
