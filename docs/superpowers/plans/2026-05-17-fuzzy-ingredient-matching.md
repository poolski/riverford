# Fuzzy Ingredient Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `filterRecipes` in `server/service.js` to use bidirectional substring matching for ingredient filtering instead of strict array equality, so that a user query of `"chicken"` correctly matches a stored ingredient of `"chicken breast"`.

**Architecture:** Two lines in `filterRecipes` change from strict `.includes()` to `.some()` with substring logic. The same fuzzy predicate applies to both `matchedIngredients` (query terms that matched) and `missingIngredients` (stored ingredients not covered by any query term). No schema changes, no re-enrichment, no client changes.

**Tech Stack:** Node.js, Vitest (test runner — `npm test` runs all tests)

---

### Task 1: Add failing service tests for fuzzy ingredient matching

**Files:**
- Modify: `server/service.test.js`

- [ ] **Step 1: Open `server/service.test.js` and add three new tests inside the `describe("recipe service", ...)` block, after the last existing test**

```js
it("matches a query ingredient that is a prefix of a stored ingredient", () => {
  const store = createRecipeStore(dbPath);
  store.upsertRecipes([
    {
      url: "https://www.riverford.co.uk/recipes/chicken-pasta",
      title: "Chicken Pasta"
    }
  ]);
  store.updateMetadata(
    "https://www.riverford.co.uk/recipes/chicken-pasta",
    {
      categories: ["Pasta"],
      ingredients: ["500g chicken breast", "300g pasta"]
    }
  );
  const service = createRecipeService({ store, fetchText: vi.fn() });

  const result = service.listRecipes({ ingredients: ["chicken"] });

  expect(result.recipes).toHaveLength(1);
  expect(result.recipes[0]).toMatchObject({
    title: "Chicken Pasta",
    matchedIngredients: ["chicken"],
    matchCount: 1
  });
  store.close();
});

it("does not match a query ingredient against an unrelated stored ingredient", () => {
  const store = createRecipeStore(dbPath);
  store.upsertRecipes([
    {
      url: "https://www.riverford.co.uk/recipes/pork-stew",
      title: "Pork Stew"
    }
  ]);
  store.updateMetadata(
    "https://www.riverford.co.uk/recipes/pork-stew",
    {
      categories: ["Main"],
      ingredients: ["500g pork shoulder"]
    }
  );
  const service = createRecipeService({ store, fetchText: vi.fn() });

  const result = service.listRecipes({ ingredients: ["chicken"] });

  expect(result.recipes).toHaveLength(0);
  store.close();
});

it("excludes a fuzzy-matched ingredient from missingIngredients", () => {
  const store = createRecipeStore(dbPath);
  store.upsertRecipes([
    {
      url: "https://www.riverford.co.uk/recipes/chicken-pasta",
      title: "Chicken Pasta"
    }
  ]);
  store.updateMetadata(
    "https://www.riverford.co.uk/recipes/chicken-pasta",
    {
      categories: ["Pasta"],
      ingredients: ["500g chicken breast", "300g pasta"]
    }
  );
  const service = createRecipeService({ store, fetchText: vi.fn() });

  const result = service.listRecipes({ ingredients: ["chicken"] });
  const recipe = result.recipes[0];

  // "chicken breast" was fuzzy-matched by "chicken" — must not appear as missing
  expect(recipe.missingIngredients).not.toContain("chicken breast");
  store.close();
});
```

it("combines title search with fuzzy ingredient filtering", () => {
  const store = createRecipeStore(dbPath);
  store.upsertRecipes([
    {
      url: "https://www.riverford.co.uk/recipes/chicken-pasta",
      title: "Chicken Pasta"
    },
    {
      url: "https://www.riverford.co.uk/recipes/chicken-soup",
      title: "Chicken Soup"
    }
  ]);
  store.updateMetadata(
    "https://www.riverford.co.uk/recipes/chicken-pasta",
    {
      categories: ["Pasta"],
      ingredients: ["500g chicken breast", "300g pasta"]
    }
  );
  store.updateMetadata(
    "https://www.riverford.co.uk/recipes/chicken-soup",
    {
      categories: ["Soup"],
      ingredients: ["chicken", "stock"]
    }
  );
  const service = createRecipeService({ store, fetchText: vi.fn() });

  const result = service.listRecipes({ title: "pasta", ingredients: ["chicken"] });

  expect(result.recipes).toHaveLength(1);
  expect(result.recipes[0].title).toBe("Chicken Pasta");
  store.close();
});

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
npm test -- server/service.test.js
```

Expected output: 3 failing tests with messages like `expected 0 to equal 1` and `expected ["chicken breast"] not to contain "chicken breast"`. All pre-existing tests should still pass.

---

### Task 2: Implement fuzzy matching in `filterRecipes`

**Files:**
- Modify: `server/service.js:97-101`

- [ ] **Step 1: Replace the `matchedIngredients` and `missingIngredients` computations in `filterRecipes`**

Current code at lines 97–101:

```js
      const matchedIngredients = normalizedQueryIngredients.filter((ingredient) =>
        recipe.normalizedIngredients.includes(ingredient)
      );
      const missingIngredients = recipe.normalizedIngredients.filter(
        (ingredient) => !matchedIngredients.includes(ingredient)
      );
```

Replace with:

```js
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

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all 56 tests pass (53 existing + 3 new). Zero failures.

- [ ] **Step 3: Commit**

```bash
git add server/service.js server/service.test.js
git commit -m "fix: use fuzzy substring matching for ingredient filtering

Strict array equality caused 'chicken' to not match stored ingredient
'chicken breast'. Both matchedIngredients and missingIngredients now
use bidirectional substring matching, consistent with matching.js."
```
