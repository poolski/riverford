import { describe, expect, it } from "vitest";
import {
  calculateRecipeCoverage,
  filterPrimaryIngredients,
  matchRecipeIngredients,
  normalizeIngredientQuery,
  rankRecipesByIngredients
} from "./matching.js";

describe("normalizeIngredientQuery", () => {
  it("splits, trims, and lowercases comma-separated ingredients", () => {
    expect(normalizeIngredientQuery(" Carrot, leek,  CHICKEN ")).toEqual([
      "carrot",
      "leek",
      "chicken"
    ]);
  });
});

describe("matchRecipeIngredients", () => {
  it("matches user ingredients against recipe ingredient text", () => {
    expect(
      matchRecipeIngredients(["carrot", "chicken"], [
        "1 whole chicken",
        "2 carrots, peeled"
      ])
    ).toEqual(["carrot", "chicken"]);
  });

  it("matches simple singular and plural forms", () => {
    expect(matchRecipeIngredients(["carrot"], ["2 carrots, peeled"])).toEqual([
      "carrot"
    ]);
    expect(matchRecipeIngredients(["tomatoes"], ["1 tomato, chopped"])).toEqual([
      "tomatoes"
    ]);
  });

  it("ignores pantry ingredients in user queries", () => {
    expect(
      matchRecipeIngredients(["olive oil", "salt", "carrot"], [
        "2 tbsp extra virgin olive oil",
        "sea salt",
        "2 carrots"
      ])
    ).toEqual(["carrot"]);
  });

  it("matches against the primary ingredient rather than incidental mentions", () => {
    expect(
      matchRecipeIngredients(["chicken"], [
        "100ml veg or chicken stock"
      ])
    ).toEqual([]);
    expect(
      matchRecipeIngredients(["stock"], [
        "100ml veg or chicken stock"
      ])
    ).toEqual(["stock"]);
    expect(
      matchRecipeIngredients(["chicken"], [
        "2 chicken fillets"
      ])
    ).toEqual(["chicken"]);
  });

  it("treats stock as the primary ingredient in flavored stock lines", () => {
    expect(matchRecipeIngredients(["chicken"], ["chicken stock"])).toEqual([]);
    expect(matchRecipeIngredients(["stock"], ["chicken stock"])).toEqual([
      "stock"
    ]);
  });

  it("does not treat ranged quantities as wildcard ingredient matches", () => {
    expect(
      matchRecipeIngredients(["courgette", "aubergine", "banana"], [
        "1-2 courgettes, peeled into long ribbons"
      ])
    ).toEqual(["courgette"]);
  });
});

describe("rankRecipesByIngredients", () => {
  it("sorts recipes by number of matched ingredients", () => {
    const recipes = [
      {
        id: 1,
        title: "Carrot Soup",
        ingredients: ["carrots", "stock"]
      },
      {
        id: 2,
        title: "Chicken Stew",
        ingredients: ["chicken", "carrots", "leeks"]
      }
    ];

    expect(rankRecipesByIngredients(recipes, ["carrot", "chicken"])).toEqual([
      expect.objectContaining({
        id: 2,
        matchedIngredients: ["carrot", "chicken"],
        matchCount: 2
      }),
      expect.objectContaining({
        id: 1,
        matchedIngredients: ["carrot"],
        matchCount: 1
      })
    ]);
  });

  it("prefers higher coverage when match counts tie", () => {
    const recipes = [
      {
        id: 1,
        title: "Long Recipe",
        ingredients: ["carrot", "chicken", "salt", "pepper", "stock"]
      },
      {
        id: 2,
        title: "Short Recipe",
        ingredients: ["carrot", "chicken", "salt"]
      }
    ];

    expect(rankRecipesByIngredients(recipes, ["carrot", "chicken"])[0]).toEqual(
      expect.objectContaining({
        id: 2,
        coverage: 1
      })
    );
  });
});

describe("calculateRecipeCoverage", () => {
  it("returns matched, missing, and coverage details", () => {
    expect(
      calculateRecipeCoverage(["carrot", "chicken"], [
        "carrot",
        "chicken",
        "stock"
      ])
    ).toEqual({
      matchedIngredients: ["carrot", "chicken"],
      missingIngredients: ["stock"],
      coverage: 2 / 3
    });
  });
});

describe("filterPrimaryIngredients", () => {
  it("ignores tablespoon, teaspoon, and common ingredients", () => {
    expect(
      filterPrimaryIngredients([
        "2 tbsp olive oil",
        "1 tsp cumin",
        "2 carrots",
        "1 whole chicken"
      ])
    ).toEqual(["2 carrots", "1 whole chicken"]);
  });

  it("excludes common pantry ingredients like butter, sugar, eggs", () => {
    expect(
      filterPrimaryIngredients([
        "butter",
        "sugar",
        "eggs",
        "salt",
        "pepper",
        "2 carrots",
        "1 whole chicken"
      ])
    ).toEqual(["2 carrots", "1 whole chicken"]);
  });

  it("excludes pantry variants like olive oil, salt and pepper, and oil for frying", () => {
    expect(
      filterPrimaryIngredients([
        "olive oil",
        "salt & pepper",
        "oil for frying",
        "2 carrots"
      ])
    ).toEqual(["2 carrots"]);
  });

  it("keeps the main ingredient text when a line has descriptive detail", () => {
    expect(
      filterPrimaryIngredients([
        "8 red onions, root left intact"
      ])
    ).toEqual(["8 red onions, root left intact"]);
  });
});
