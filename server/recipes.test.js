import { describe, expect, it } from "vitest";
import {
  deriveTitleFromUrl,
  extractRecipeMetadata,
  parseSitemap
} from "./recipes.js";

describe("parseSitemap", () => {
  it("returns recipe URLs from a sitemap document", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://www.riverford.co.uk/recipes/aglio-olio</loc></url>
        <url><loc>https://www.riverford.co.uk/recipes/poached-chicken</loc></url>
      </urlset>`;

    expect(parseSitemap(xml)).toEqual([
      "https://www.riverford.co.uk/recipes/aglio-olio",
      "https://www.riverford.co.uk/recipes/poached-chicken"
    ]);
  });
});

describe("deriveTitleFromUrl", () => {
  it("turns a recipe slug into a readable title", () => {
    expect(
      deriveTitleFromUrl(
        "https://www.riverford.co.uk/recipes/poached-chicken-with-salsa-verde"
      )
    ).toBe("Poached Chicken With Salsa Verde");
  });
});

describe("extractRecipeMetadata", () => {
  it("reads categories and ingredients from recipe JSON-LD", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Recipe",
              "recipeCategory": ["Chicken", "Main"],
              "recipeIngredient": [["1 chicken", "2 carrots"]]
            }
          </script>
        </head>
      </html>
    `;

    expect(extractRecipeMetadata(html)).toEqual({
      categories: ["Chicken", "Main"],
      ingredients: ["1 chicken", "2 carrots"],
      cookTime: null,
      servings: null
    });
  });

  it("deduplicates repeated categories", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Recipe","recipeCategory":["Quick ideas","Quick ideas"]}
      </script>
    `;

    expect(extractRecipeMetadata(html).categories).toEqual(["Quick ideas"]);
  });

  it("reads cook time and servings from recipe JSON-LD", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type":"Recipe",
          "cookTime":"PT45M",
          "recipeYield":"4"
        }
      </script>
    `;

    expect(extractRecipeMetadata(html)).toEqual({
      categories: [],
      ingredients: [],
      cookTime: "PT45M",
      servings: "4"
    });
  });
});
