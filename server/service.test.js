import { afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { createRecipeService } from "./service.js";
import { createRecipeStore } from "./store.js";

const dbPath = "data/test-service.sqlite";

afterEach(() => {
  rmSync(dbPath, { force: true });
});

describe("recipe service", () => {
  it("returns store data immediately when store is populated, even if refresh is slow", async () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        title: "Aglio Olio"
      }
    ]);
    // fetchText hangs indefinitely — response must not wait for it
    const fetchText = vi.fn(() => new Promise(() => {}));
    const service = createRecipeService({ store, fetchText });

    const result = await service.refreshRecipes();

    expect(result).toEqual({ usedCache: false, total: 1 });
    store.close();
  });

  it("marks usedCache after background refresh detects site is unavailable", async () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        title: "Aglio Olio"
      }
    ]);
    let rejectFetch;
    const fetchText = vi.fn(
      () => new Promise((_, rej) => { rejectFetch = rej; })
    );
    const service = createRecipeService({ store, fetchText });

    await service.refreshRecipes();
    expect(service.getStatus()).toMatchObject({ usedCache: false });

    rejectFetch(new Error("offline"));
    await vi.waitFor(() => service.getStatus().usedCache === true);

    expect(service.listRecipes()).toEqual(
      expect.objectContaining({
        usedCache: true,
        recipes: [expect.objectContaining({ title: "Aglio Olio" })]
      })
    );
    store.close();
  });

  it("does not re-fetch the sitemap within the refresh TTL", async () => {
    const store = createRecipeStore(dbPath);
    const fetchText = vi.fn().mockResolvedValue(`
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://www.riverford.co.uk/recipes/aglio-olio</loc></url>
      </urlset>
    `);
    const service = createRecipeService({ store, fetchText });

    await service.refreshRecipes();
    await service.refreshRecipes();

    expect(fetchText).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("re-fetches the sitemap after the TTL expires", async () => {
    vi.useFakeTimers();
    const store = createRecipeStore(dbPath);
    const fetchText = vi.fn().mockResolvedValue(`
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://www.riverford.co.uk/recipes/aglio-olio</loc></url>
      </urlset>
    `);
    const service = createRecipeService({ store, fetchText });

    await service.refreshRecipes();
    vi.advanceTimersByTime(6 * 60 * 1000); // past 5-minute TTL
    await service.refreshRecipes();

    expect(fetchText).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    store.close();
  });

  it("deduplicates concurrent refreshRecipes calls", async () => {
    const store = createRecipeStore(dbPath);
    let resolveFetch;
    const fetchText = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    const service = createRecipeService({ store, fetchText });

    const first = service.refreshRecipes();
    const second = service.refreshRecipes();

    expect(fetchText).toHaveBeenCalledTimes(1);
    resolveFetch(`
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://www.riverford.co.uk/recipes/aglio-olio</loc></url>
      </urlset>
    `);
    await Promise.all([first, second]);
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

  it("updates the recipe title from the JSON-LD name field during enrichment", async () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        title: "Aglio Olio"
      }
    ]);
    const fetchText = vi.fn().mockResolvedValue(`
      <script type="application/ld+json">
        {"@type":"Recipe","name":"Aglio e Olio with Parsley","recipeCategory":["Veg"]}
      </script>
    `);
    const service = createRecipeService({ store, fetchText });

    await service.enrichPendingRecipes();

    expect(service.listRecipes().recipes[0].title).toBe("Aglio e Olio with Parsley");
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
        metadataVersion: 5
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

    const recipes = service.listRecipes({
      terms: ["soup", "potato"],
      category: "Soup"
    }).recipes;

    // Both recipes match "soup" and "potato" via title. Potato Soup also
    // matches "potato" via ingredient, so it ranks first.
    expect(recipes[0]).toMatchObject({
      title: "Potato Soup",
      matchedIngredients: ["potato"]
    });
    expect(recipes[1]).toMatchObject({
      title: "Sweet Potato Soup",
      matchedIngredients: []
    });
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

    const result = service.listRecipes({ terms: ["chicken"] });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]).toMatchObject({
      title: "Chicken Pasta",
      matchedIngredients: ["chicken"],
      matchCount: 1
    });
    store.close();
  });

  it("normalizes any 'X stock' ingredient to stock for matching", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/chicken-stew",
        title: "Winter Broth"
      }
    ]);
    store.updateMetadata(
      "https://www.riverford.co.uk/recipes/chicken-stew",
      {
        categories: ["Main"],
        ingredients: ["800ml chicken stock"]
      }
    );
    const service = createRecipeService({ store, fetchText: vi.fn() });

    expect(service.listRecipes({ terms: ["chicken"] }).recipes).toHaveLength(0);
    expect(service.listRecipes({ terms: ["stock"] }).recipes).toHaveLength(1);
    store.close();
  });

  it("treats stock-derived ingredients like stock cubes as stock", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/veg-stew",
        title: "Veg Stew"
      }
    ]);
    store.updateMetadata("https://www.riverford.co.uk/recipes/veg-stew", {
      categories: ["Main"],
      ingredients: ["1 chicken stock cube"]
    });
    const service = createRecipeService({ store, fetchText: vi.fn() });

    expect(service.listRecipes({ terms: ["chicken"] }).recipes).toHaveLength(0);
    expect(service.listRecipes({ terms: ["stock"] }).recipes).toHaveLength(1);
    store.close();
  });

  it("treats multi-option stock lines as stock", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/root-broth",
        title: "Root Broth"
      }
    ]);
    store.updateMetadata("https://www.riverford.co.uk/recipes/root-broth", {
      categories: ["Main"],
      ingredients: ["chicken, duck, beef or vegetable stock"]
    });
    const service = createRecipeService({ store, fetchText: vi.fn() });

    expect(service.listRecipes({ terms: ["chicken"] }).recipes).toHaveLength(0);
    expect(service.listRecipes({ terms: ["stock"] }).recipes).toHaveLength(1);
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

    const result = service.listRecipes({ terms: ["chicken"] });

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

    const result = service.listRecipes({ terms: ["chicken"] });
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

    const result = service.listRecipes({ terms: ["pasta", "chicken"] });

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].title).toBe("Chicken Pasta");
    store.close();
  });

  it("marks selected URLs for refresh and returns status", async () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/a",
        title: "Recipe A"
      }
    ]);
    store.updateMetadata("https://www.riverford.co.uk/recipes/a", {
      categories: ["Veg"],
      ingredients: ["carrot"]
    });
    const service = createRecipeService({ store, fetchText: vi.fn() });

    const status = await service.requestRecipeRefresh({
      urls: ["https://www.riverford.co.uk/recipes/a"],
      force: false
    });

    expect(status).toMatchObject({ total: 1 });
    expect(store.listPendingRecipeUrls()).toEqual([
      "https://www.riverford.co.uk/recipes/a"
    ]);
    store.close();
  });
});
