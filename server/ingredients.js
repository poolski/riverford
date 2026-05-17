const PANTRY_INGREDIENTS = new Set([
  "butter",
  "sugar",
  "salt",
  "pepper",
  "egg",
  "milk",
  "flour",
  "water",
  "oil",
  "vanilla",
  "baking powder",
  "baking soda",
  "yeast"
]);

export function normalizeRecipeIngredients(ingredients = []) {
  return [
    ...new Set(
      ingredients
        .map(normalizeIngredient)
        .filter((ingredient) => ingredient && !isPantryIngredient(ingredient))
    )
  ];
}

export function normalizeIngredient(ingredient) {
  const normalizedBase = ingredient
    .toLowerCase()
    .replace(
      /^\s*\d+(?:[./]\d+)?(?:\s*-\s*\d+(?:[./]\d+)?)?\s*(?:ml|g|kg|l)?\s*(?:of\s+)?/i,
      ""
    )
    .split(/[–—]/)[0]
    .trim();

  if (/\bstock\b/.test(normalizedBase)) return "stock";

  let normalized = normalizedBase.split(",")[0].trim();

  normalized = normalized
    .replace(/^(?:a few|few|small bunch of|bunch of|handfuls? of)\s+/, "")
    .replace(/^(?:large|small|fresh|dried|minced|chopped|crushed)\s+/, "")
    .trim();

  if (/\bgarlic\b/.test(normalized)) return "garlic";
  if (normalized === "salt & pepper" || normalized === "salt and pepper") {
    return "salt";
  }
  if (normalized.startsWith("oil ")) return "oil";

  normalized = normalized.replace(/\bcloves? of\s+/, "");

  return singularize(normalized);
}

function isPantryIngredient(ingredient) {
  return (
    PANTRY_INGREDIENTS.has(ingredient) ||
    ingredient.endsWith(" oil") ||
    ingredient.endsWith(" salt") ||
    ingredient.endsWith(" pepper")
  );
}

function singularize(term) {
  if (term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.endsWith("oes")) return term.slice(0, -2);
  if (term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);
  return term;
}
