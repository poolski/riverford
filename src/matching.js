export function normalizeIngredientQuery(query) {
  return query
    .split(",")
    .map((ingredient) => ingredient.trim().toLowerCase())
    .filter(Boolean);
}

export function matchRecipeIngredients(queryIngredients, recipeIngredients = []) {
  return filterQueryIngredients(queryIngredients).filter((queryIngredient) =>
    recipeIngredients.some((recipeIngredient) =>
      ingredientTerms(queryIngredient).some((queryTerm) =>
        ingredientTerms(primaryIngredientText(recipeIngredient)).some(
          (recipeTerm) =>
            recipeTerm.includes(queryTerm) || queryTerm.includes(recipeTerm)
        )
      )
    )
  );
}

export function rankRecipesByIngredients(recipes, queryIngredients) {
  return recipes
    .map((recipe) => {
      const primaryIngredients = filterPrimaryIngredients(recipe.ingredients);
      const coverage = calculateRecipeCoverage(
        queryIngredients,
        primaryIngredients
      );
      return {
        ...recipe,
        primaryIngredients,
        ...coverage,
        matchCount: coverage.matchedIngredients.length
      };
    })
    .filter((recipe) => recipe.matchCount > 0)
    .sort(
      (left, right) =>
        right.matchCount - left.matchCount ||
        right.coverage - left.coverage ||
        left.title.localeCompare(right.title)
    );
}

export function calculateRecipeCoverage(queryIngredients, recipeIngredients = []) {
  const primaryQueryIngredients = filterQueryIngredients(queryIngredients);
  const matchedIngredients = matchRecipeIngredients(
    primaryQueryIngredients,
    recipeIngredients
  );
  const missingIngredients = recipeIngredients.filter(
    (recipeIngredient) =>
      !primaryQueryIngredients.some((queryIngredient) =>
        ingredientTerms(queryIngredient).some((queryTerm) =>
          ingredientTerms(primaryIngredientText(recipeIngredient)).some(
            (recipeTerm) =>
              recipeTerm.includes(queryTerm) || queryTerm.includes(recipeTerm)
          )
        )
      )
  );

  return {
    matchedIngredients,
    missingIngredients,
    coverage:
      recipeIngredients.length === 0
        ? 0
        : matchedIngredients.length / recipeIngredients.length
  };
}

export function filterPrimaryIngredients(recipeIngredients = []) {
  return recipeIngredients.filter(
    (ingredient) =>
      !/\b(?:tsp|tbsp|teaspoons?|tablespoons?)\b/i.test(ingredient) &&
      !isPantryIngredient(primaryIngredientText(ingredient))
  );
}

export function filterQueryIngredients(queryIngredients = []) {
  return queryIngredients.filter(
    (ingredient) => !isPantryIngredient(primaryIngredientText(ingredient))
  );
}

export function primaryIngredientText(ingredient) {
  const withoutQuantity = ingredient
    .toLowerCase()
    .replace(
      /^\s*\d+(?:[./]\d+)?(?:\s*-\s*\d+(?:[./]\d+)?)?\s*(?:ml|g|kg|l)?\s*/i,
      ""
    )
    .split(/[–—-]/)[0]
    .split(",")[0]
    .trim();

  if (/\bstock$/.test(withoutQuantity)) {
    return "stock";
  }

  if (/\bor\b/.test(withoutQuantity)) {
    const words = withoutQuantity.split(/\s+/);
    return words.at(-1);
  }

  return withoutQuantity;
}

function ingredientTerms(ingredient) {
  const normalized = ingredient.toLowerCase();
  const aliasExpanded = PANTRY_ALIASES[normalized] ?? [normalized];
  return aliasExpanded
    .flatMap((term) => [term, singularize(term)])
    .filter(Boolean);
}

function isPantryIngredient(ingredient) {
  return PANTRY_INGREDIENTS.some((pantryIngredient) =>
    ingredientTerms(ingredient).some(
      (ingredientTerm) =>
        ingredientTerm === pantryIngredient ||
        ingredientTerm.endsWith(` ${pantryIngredient}`) ||
        ingredientTerm.startsWith(`${pantryIngredient} `)
    )
  );
}

function singularize(term) {
  if (term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.endsWith("oes")) return term.slice(0, -2);
  if (term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);
  return term;
}

const PANTRY_ALIASES = {
  "olive oil": ["olive oil", "extra virgin olive oil"],
  salt: ["salt", "sea salt"],
  sugar: ["sugar", "granulated sugar", "caster sugar"],
  flour: ["flour", "all-purpose flour", "plain flour"],
  milk: ["milk", "whole milk", "skim milk"],
  butter: ["butter", "unsalted butter", "salted butter"]
};

const PANTRY_INGREDIENTS = [
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
];
