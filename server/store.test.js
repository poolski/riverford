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

  it("persists and returns the image URL through updateMetadata", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      { url: "https://www.riverford.co.uk/recipes/aglio-olio", title: "Aglio Olio" }
    ]);
    store.updateMetadata("https://www.riverford.co.uk/recipes/aglio-olio", {
      categories: [],
      ingredients: [],
      image: "https://cdn.riverford.co.uk/aglio.jpg"
    });

    expect(store.listRecipes()[0]).toMatchObject({
      image: "https://cdn.riverford.co.uk/aglio.jpg"
    });
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

  it("marks selected recipes for refresh and returns them as pending", () => {
    const store = createRecipeStore(dbPath);
    store.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/a",
        title: "Recipe A"
      },
      {
        url: "https://www.riverford.co.uk/recipes/b",
        title: "Recipe B"
      }
    ]);
    store.updateMetadata("https://www.riverford.co.uk/recipes/a", {
      categories: ["Veg"],
      ingredients: ["carrot"]
    });
    store.updateMetadata("https://www.riverford.co.uk/recipes/b", {
      categories: ["Veg"],
      ingredients: ["leek"]
    });

    store.markRefreshRequested(["https://www.riverford.co.uk/recipes/b"]);

    expect(store.listPendingRecipeUrls()).toEqual([
      "https://www.riverford.co.uk/recipes/b"
    ]);
    store.close();
  });

  it("saves and unsaves recipes by id across store instances", () => {
    const first = createRecipeStore(dbPath);
    first.upsertRecipes([
      {
        url: "https://www.riverford.co.uk/recipes/a",
        title: "Recipe A"
      }
    ]);
    const recipe = first.listRecipes()[0];
    first.saveRecipe(recipe.id);
    first.close();

    const second = createRecipeStore(dbPath);
    expect(second.listSavedRecipeIds()).toEqual([recipe.id]);
    second.unsaveRecipe(recipe.id);
    expect(second.listSavedRecipeIds()).toEqual([]);
    second.close();
  });
});
