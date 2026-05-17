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
      name: null,
      categories: ["Chicken", "Main"],
      ingredients: ["1 chicken", "2 carrots"],
      cookTime: null,
      servings: null,
      image: null
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

  it("extracts an image URL when the image property is a string", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Recipe","image":"https://cdn.riverford.co.uk/aglio.jpg"}
      </script>
    `;

    expect(extractRecipeMetadata(html).image).toBe(
      "https://cdn.riverford.co.uk/aglio.jpg"
    );
  });

  it("extracts an image URL when the image property is an ImageObject", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Recipe","image":{"@type":"ImageObject","url":"https://cdn.riverford.co.uk/aglio.jpg"}}
      </script>
    `;

    expect(extractRecipeMetadata(html).image).toBe(
      "https://cdn.riverford.co.uk/aglio.jpg"
    );
  });

  it("extracts the first image when the image property is an array", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Recipe","image":["https://cdn.riverford.co.uk/aglio-1.jpg","https://cdn.riverford.co.uk/aglio-2.jpg"]}
      </script>
    `;

    expect(extractRecipeMetadata(html).image).toBe(
      "https://cdn.riverford.co.uk/aglio-1.jpg"
    );
  });

  it("returns null image when no image is present", () => {
    const html = `
      <script type="application/ld+json">{"@type":"Recipe"}</script>
    `;

    expect(extractRecipeMetadata(html).image).toBeNull();
  });

  it("extracts the recipe name from JSON-LD", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Recipe","name":"Aglio e Olio"}
      </script>
    `;

    expect(extractRecipeMetadata(html).name).toBe("Aglio e Olio");
  });

  it("returns null name when no name is present", () => {
    const html = `
      <script type="application/ld+json">{"@type":"Recipe"}</script>
    `;

    expect(extractRecipeMetadata(html).name).toBeNull();
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
      name: null,
      categories: [],
      ingredients: [],
      cookTime: "PT45M",
      servings: "4",
      image: null
    });
  });
});
