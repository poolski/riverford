import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { createRecipeStore } from "./store.js";

const dbPath = "data/test-recipes.sqlite";

afterEach(() => {
  rmSync(dbPath, { force: true });
});

describe("recipe store", () => {
  it("persists recipes and reuses them across runs", () => {
    const first = createRecipeStore(dbPath);
    first.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        title: "Aglio Olio"
      }
    ]);
    first.updateMetadata("https://www.riverford.co.uk/recipes/aglio-olio", {
      categories: ["Veg"],
      ingredients: ["garlic", "olive oil"],
      cookTime: "PT20M",
      servings: "2"
    });
    first.close();

    const second = createRecipeStore(dbPath);
    expect(second.listRecipes()).toEqual([
      expect.objectContaining({
        title: "Aglio Olio",
        categories: ["Veg"],
        ingredients: ["garlic", "olive oil"],
        normalizedIngredients: ["garlic"],
        cookTime: "PT20M",
        servings: "2",
        enrichmentStatus: "enriched"
      })
    ]);
    second.close();
  });

  it("returns already-enriched recipes that still need metadata backfill", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        title: "Aglio Olio"
      }
    ]);
    store.updateMetadata("https://www.riverford.co.uk/recipes/aglio-olio", {
      categories: ["Veg"],
      ingredients: ["garlic"]
    });
    store.markMetadataVersion(
      "https://www.riverford.co.uk/recipes/aglio-olio",
      1
    );

    expect(store.listPendingRecipeUrls()).toEqual([
      "https://www.riverford.co.uk/recipes/aglio-olio"
    ]);
    store.close();
  });

  it("stops backfilling once the current metadata version has been recorded", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        title: "Aglio Olio"
      }
    ]);
    store.updateMetadata("https://www.riverford.co.uk/recipes/aglio-olio", {
      categories: ["Veg"],
      ingredients: ["garlic"],
      cookTime: null,
      servings: null
    });

    expect(store.listPendingRecipeUrls()).toEqual([]);
    store.close();
  });
});
