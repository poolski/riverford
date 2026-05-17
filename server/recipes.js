export function parseSitemap(xml) {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
}

export function deriveTitleFromUrl(url) {
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function extractRecipeMetadata(html) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis)];

  for (const [, rawJson] of scripts) {
    try {
      const parsed = JSON.parse(rawJson);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const recipe = nodes.find((node) => node?.["@type"] === "Recipe");
      if (!recipe) continue;

      return {
        categories: Array.isArray(recipe.recipeCategory)
          ? [...new Set(recipe.recipeCategory)]
          : [],
        ingredients: Array.isArray(recipe.recipeIngredient)
          ? recipe.recipeIngredient.flat()
          : [],
        cookTime: recipe.cookTime ?? null,
        servings: recipe.recipeYield ?? null
      };
    } catch {
      continue;
    }
  }

  return { categories: [], ingredients: [], cookTime: null, servings: null };
}
