# Fuzzy Ingredient Matching in filterRecipes

**Date**: 2026-05-17

## Problem

Combining a title search ("pasta") with ingredient chips ("chicken") returns "No recipes match that search" even when pasta recipes containing chicken exist in the database.

**Root cause**: `filterRecipes` in `server/service.js` uses strict array equality (`recipe.normalizedIngredients.includes(ingredient)`) when checking whether a user's query ingredient matches a recipe's stored ingredients. A recipe with raw ingredient `"500g chicken breast"` normalizes to `"chicken breast"` at enrichment time. The user query `"chicken"` normalizes to `"chicken"`. Because `"chicken" !== "chicken breast"`, the match fails.

The client-side `matching.js` already uses bidirectional substring matching for the same purpose; the server does not.

## Scope

Single function change in `server/service.js`. No schema changes, no re-enrichment of stored data, no client-side changes.

## Design

### Change to `filterRecipes`

Replace the strict `.includes()` check in the `matchedIngredients` computation with a `.some()` that does bidirectional substring matching, and fix `missingIngredients` to use the same logic:

```js
// Before
const matchedIngredients = normalizedQueryIngredients.filter((ingredient) =>
  recipe.normalizedIngredients.includes(ingredient)
);
const missingIngredients = recipe.normalizedIngredients.filter(
  (ingredient) => !matchedIngredients.includes(ingredient)
);

// After
const matchedIngredients = normalizedQueryIngredients.filter((queryIngredient) =>
  recipe.normalizedIngredients.some(
    (recipeIngredient) =>
      recipeIngredient.includes(queryIngredient) || queryIngredient.includes(recipeIngredient)
  )
);
const missingIngredients = recipe.normalizedIngredients.filter(
  (recipeIngredient) =>
    !normalizedQueryIngredients.some(
      (queryIngredient) =>
        recipeIngredient.includes(queryIngredient) || queryIngredient.includes(recipeIngredient)
    )
);
```

`matchedIngredients` holds user query terms that fuzzy-matched at least one stored ingredient. `missingIngredients` holds stored ingredient strings that no query term fuzzy-matched. Both need the same substring logic; the old `missingIngredients` used `matchedIngredients.includes(storedIngredient)` which compared stored strings (e.g. `"chicken breast"`) against query terms (e.g. `"chicken"`) and would always find them "missing" despite a successful fuzzy match.

All other logic in `filterRecipes` (title filter, category filter, `matchCount > 0` gate, sort order) is unchanged.

### Matching semantics

A user query ingredient matches a stored recipe ingredient if either string contains the other as a substring. Examples:

| Query | Stored | Matches? | Reason |
| ----- | ------ | -------- | ------ |
| `chicken` | `chicken breast` | yes | stored contains query |
| `chicken` | `chicken` | yes | exact |
| `chicken` | `pork` | no | neither contains the other |
| `pea` | `peanut` | yes | stored contains query (known trade-off, same as `matching.js`) |

The `pea`/`peanut` false-positive is an accepted trade-off, consistent with the existing approach in `matching.js`.

### Combined title + ingredient filtering

No architectural change needed. `filterRecipes` already applies title, category, and ingredient filters in sequence. The fuzzy match fix makes the ingredient step work correctly, which unblocks the combined case.

## Testing

New tests needed in `server/service.test.js`:

1. `"chicken"` matches a recipe whose stored ingredient is `"chicken breast"` — verifies the fix
2. `"chicken"` does not match a recipe with only `"pork"` — verifies no over-matching
3. Title `"pasta"` + ingredient `"chicken"` returns pasta recipes containing chicken — verifies the combined case end-to-end

Existing tests must continue to pass without modification.
