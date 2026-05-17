import { afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { createRecipeService } from "./service.js";
import { createRecipeStore } from "./store.js";

const dbPath = "data/test-service.sqlite";

afterEach(() => {
  rmSync(dbPath, { force: true });
});

describe("recipe service", () => {
  it("returns cached data when the live sitemap fetch fails", async () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        title: "Aglio Olio"
      }
    ]);

    const service = createRecipeService({
      store,
      fetchText: vi.fn().mockRejectedValue(new Error("offline"))
    });

    await expect(service.refreshRecipes()).resolves.toEqual({
      usedCache: true,
      total: 1
    });
    expect(service.listRecipes()).toEqual(
      expect.objectContaining({
        usedCache: true,
        recipes: [expect.objectContaining({ title: "Aglio Olio" })]
      })
    );
    store.close();
  });

  it("returns lightweight status without recipe payloads", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        title: "Aglio Olio"
      }
    ]);
    const service = createRecipeService({ store, fetchText: vi.fn() });

    expect(service.getStatus()).toEqual({
      usedCache: false,
      total: 1,
      enriched: 0
    });
    store.close();
  });

  it("returns the sitemap list before enrichment completes", async () => {
    const store = createRecipeStore(dbPath);
    const fetchText = vi
      .fn()
      .mockResolvedValueOnce(`
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://www.riverford.co.uk/recipes/aglio-olio</loc></url>
        </urlset>
      `)
      .mockResolvedValueOnce(`
        <script type="application/ld+json">
          {"@type":"Recipe","recipeCategory":["Veg"],"recipeIngredient":[["garlic"]]}
        </script>
      `);
    const service = createRecipeService({ store, fetchText });

    await service.refreshRecipes();
    expect(service.listRecipes().recipes).toEqual([
      expect.objectContaining({
        title: "Aglio Olio",
        enrichmentStatus: "pending"
      })
    ]);

    await service.enrichPendingRecipes();
    expect(service.listRecipes().recipes).toEqual([
      expect.objectContaining({
        categories: ["Veg"],
        enrichmentStatus: "enriched"
      })
    ]);
    store.close();
  });

  it("continues enriching after a recipe fetch times out", async () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/slow",
        title: "Slow"
      },
      {
        url: "https://www.riverford.co.uk/recipes/fast",
        title: "Fast"
      }
    ]);
    const fetchText = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(`
        <script type="application/ld+json">
          {"@type":"Recipe","recipeCategory":["Veg"],"recipeIngredient":[["carrot"]]}
        </script>
      `);
    const service = createRecipeService({ store, fetchText });

    await service.enrichPendingRecipes();

    expect(service.listRecipes().recipes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Fast",
          enrichmentStatus: "enriched"
        }),
        expect.objectContaining({
          title: "Slow",
          enrichmentStatus: "pending"
        })
      ])
    );
    store.close();
  });

  it("does not start overlapping enrichment runs", async () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/slow",
        title: "Slow"
      }
    ]);
    let resolveFetch;
    const fetchText = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    const service = createRecipeService({ store, fetchText });

    const firstRun = service.enrichPendingRecipes();
    const secondRun = service.enrichPendingRecipes();

    expect(fetchText).toHaveBeenCalledTimes(1);
    resolveFetch(`
      <script type="application/ld+json">
        {"@type":"Recipe","recipeCategory":["Veg"],"recipeIngredient":[["carrot"]]}
      </script>
    `);
    await Promise.all([firstRun, secondRun]);
    store.close();
  });

  it("backfills recipes from older metadata versions", async () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        title: "Aglio Olio"
      }
    ]);
    store.markMetadataVersion(
      "https://www.riverford.co.uk/recipes/aglio-olio",
      1
    );
    const service = createRecipeService({
      store,
      fetchText: vi.fn().mockResolvedValue(`
        <script type="application/ld+json">
          {"@type":"Recipe","cookTime":"PT20M","recipeYield":"2"}
        </script>
      `)
    });

    await service.enrichPendingRecipes();

    expect(service.listRecipes().recipes[0]).toEqual(
      expect.objectContaining({
        cookTime: "PT20M",
        servings: "2",
        metadataVersion: 3
      })
    );
    store.close();
  });

  it("filters and ranks recipes from canonical backend ingredients", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/sweet-potato-soup",
        title: "Sweet Potato Soup"
      },
      {
        url: "https://www.riverford.co.uk/recipes/potato-soup",
        title: "Potato Soup"
      }
    ]);
    store.updateMetadata(
      "https://www.riverford.co.uk/recipes/sweet-potato-soup",
      {
        categories: ["Soup"],
        ingredients: ["2 sweet potatoes", "2 cloves of garlic"]
      }
    );
    store.updateMetadata("https://www.riverford.co.uk/recipes/potato-soup", {
      categories: ["Soup"],
      ingredients: ["2 potatoes", "800ml chicken stock"]
    });
    const service = createRecipeService({ store, fetchText: vi.fn() });

    expect(
      service.listRecipes({
        title: "soup",
        ingredients: ["potato"],
        category: "Soup"
      }).recipes
    ).toEqual([
      expect.objectContaining({
        title: "Potato Soup",
        matchedIngredients: ["potato"]
      })
    ]);
    store.close();
  });

  it("matches a query ingredient that is a prefix of a stored ingredient", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/chicken-pasta",
        title: "Chicken Pasta"
      }
    ]);
    store.updateMetadata(
      "https://www.riverford.co.uk/recipes/chicken-pasta",
      {
        categories: ["Pasta"],
        ingredients: ["500g chicken breast", "300g pasta"]
      }
    );
    const service = createRecipeService({ store, fetchText: vi.fn() });

    const result = service.listRecipes({ ingredients: ["chicken"] });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]).toMatchObject({
      title: "Chicken Pasta",
      matchedIngredients: ["chicken"],
      matchCount: 1
    });
    store.close();
  });

  it("does not match a query ingredient against an unrelated stored ingredient", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/pork-stew",
        title: "Pork Stew"
      }
    ]);
    store.updateMetadata(
      "https://www.riverford.co.uk/recipes/pork-stew",
      {
        categories: ["Main"],
        ingredients: ["500g pork shoulder"]
      }
    );
    const service = createRecipeService({ store, fetchText: vi.fn() });

    const result = service.listRecipes({ ingredients: ["chicken"] });

    expect(result.recipes).toHaveLength(0);
    store.close();
  });

  it("excludes a fuzzy-matched ingredient from missingIngredients", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/chicken-pasta",
        title: "Chicken Pasta"
      }
    ]);
    store.updateMetadata(
      "https://www.riverford.co.uk/recipes/chicken-pasta",
      {
        categories: ["Pasta"],
        ingredients: ["500g chicken breast", "300g pasta"]
      }
    );
    const service = createRecipeService({ store, fetchText: vi.fn() });

    const result = service.listRecipes({ ingredients: ["chicken"] });
    const recipe = result.recipes[0];

    expect(recipe.missingIngredients).not.toContain("chicken breast");
    store.close();
  });

  it("combines title search with fuzzy ingredient filtering", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/chicken-pasta",
        title: "Chicken Pasta"
      },
      {
        url: "https://www.riverford.co.uk/recipes/chicken-soup",
        title: "Chicken Soup"
      }
    ]);
    store.updateMetadata(
      "https://www.riverford.co.uk/recipes/chicken-pasta",
      {
        categories: ["Pasta"],
        ingredients: ["500g chicken breast", "300g pasta"]
      }
    );
    store.updateMetadata(
      "https://www.riverford.co.uk/recipes/chicken-soup",
      {
        categories: ["Soup"],
        ingredients: ["chicken", "stock"]
      }
    );
    const service = createRecipeService({ store, fetchText: vi.fn() });

    const result = service.listRecipes({ title: "pasta", ingredients: ["chicken"] });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].title).toBe("Chicken Pasta");
    store.close();
  });
});
