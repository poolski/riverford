import { describe, expect, it } from "vitest";
import {
  normalizeIngredient,
  normalizeRecipeIngredients
} from "./ingredients.js";

describe("normalizeIngredient", () => {
  it("canonicalizes common garlic forms", () => {
    expect(normalizeIngredient("2-3 cloves of garlic")).toBe("garlic");
    expect(normalizeIngredient("2 large cloves of garlic")).toBe("garlic");
    expect(normalizeIngredient("garlic clove")).toBe("garlic");
    expect(normalizeIngredient("minced garlic")).toBe("garlic");
    expect(normalizeIngredient("garlic, chopped")).toBe("garlic");
  });

  it("canonicalizes stock forms", () => {
    expect(normalizeIngredient("800ml of chicken stock")).toBe("stock");
    expect(normalizeIngredient("800ml chicken stock")).toBe("stock");
    expect(normalizeIngredient("450ml chicken or veg stock")).toBe("stock");
  });

  it("keeps distinct two-word ingredients distinct", () => {
    expect(normalizeIngredient("sweet potato")).toBe("sweet potato");
    expect(normalizeIngredient("potato")).toBe("potato");
  });
});

describe("normalizeRecipeIngredients", () => {
  it("removes pantry ingredients and deduplicates canonical ingredients", () => {
    expect(
      normalizeRecipeIngredients([
        "2 carrots",
        "olive oil",
        "salt & pepper",
        "2-3 cloves of garlic",
        "garlic, chopped"
      ])
    ).toEqual(["carrot", "garlic"]);
  });
});
