# Unified Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-bar search UI (recipe title + ingredient chips) with a single unified search bar where each chip matches against both recipe titles and ingredients.

**Architecture:** Four layers change together. The server's `filterRecipes` switches from separate `title`/`ingredients` filters to a unified `terms` array where each term is checked against title (substring) or normalised ingredients (startsWith). The HTTP layer maps a single `q` query param to `terms`. The React app collapses two state variables and two inputs into one `chips` array and one `UnifiedSearch` component. Tests throughout update to reflect the new API shape and interaction model.

**Tech Stack:** Node.js/Express (server), React (client), Vitest + Testing Library (tests). Run `npm test` to execute the full suite.

---

### Task 1: Update `filterRecipes` in `server/service.js`

**Files:**
- Modify: `server/service.test.js` (update existing tests + four recently-added tests)
- Modify: `server/service.js:84-130`

**Background:** `filterRecipes` currently accepts `{ title, ingredients, category }`. We replace `title` + `ingredients` with `terms: string[]`. A recipe matches if every term satisfies at least one of: title contains term (case-insensitive) OR any `normalizedIngredient` starts-with the term (bidirectional). The recipe keep their `matchedIngredients`, `missingIngredients`, `matchCount`, and `coverage` fields — the semantics stay the same (terms that matched via ingredient path).

- [ ] **Step 1: Update the existing combined-filter service test to use `terms`**

In `server/service.test.js`, find the test `"filters and ranks recipes from canonical backend ingredients"` (around line 194). Replace its `listRecipes` call:

```js
// before
service.listRecipes({
  title: "soup",
  ingredients: ["potato"],
  category: "Soup"
})

// after
service.listRecipes({
  terms: ["soup", "potato"],
  category: "Soup"
})
```

The `.toEqual` assertion stays unchanged — it already expects only `"Potato Soup"` with `matchedIngredients: ["potato"]`.

- [ ] **Step 2: Update the four fuzzy-matching tests to use `terms`**

In `server/service.test.js`, find the four tests added in the previous work session (starting around line 235). Change every `listRecipes({ ingredients: [...] })` and `listRecipes({ title: ..., ingredients: [...] })` call:

```js
// "matches a query ingredient that is a prefix of a stored ingredient"
// before: service.listRecipes({ ingredients: ["chicken"] })
service.listRecipes({ terms: ["chicken"] })

// "does not match a query ingredient against an unrelated stored ingredient"
// before: service.listRecipes({ ingredients: ["chicken"] })
service.listRecipes({ terms: ["chicken"] })

// "excludes a fuzzy-matched ingredient from missingIngredients"
// before: service.listRecipes({ ingredients: ["chicken"] })
service.listRecipes({ terms: ["chicken"] })

// "combines title search with fuzzy ingredient filtering"
// before: service.listRecipes({ title: "pasta", ingredients: ["chicken"] })
service.listRecipes({ terms: ["pasta", "chicken"] })
```

- [ ] **Step 3: Run the service tests — confirm they fail**

```bash
npm test -- server/service.test.js
```

Expected: 5 failures (the 5 tests just updated). All other tests pass.

- [ ] **Step 4: Rewrite `filterRecipes` in `server/service.js`**

Replace the entire `filterRecipes` function (lines 84–130):

```js
function filterRecipes(recipes, { terms = [], category } = {}) {
  const normalizedTerms = [
    ...new Set(terms.map(normalizeIngredient).filter(Boolean))
  ];

  return recipes
    .filter((recipe) =>
      normalizedTerms.length === 0 ||
      normalizedTerms.every(
        (term) =>
          recipe.title.toLowerCase().includes(term) ||
          recipe.normalizedIngredients.some(
            (ri) => ri.startsWith(term) || term.startsWith(ri)
          )
      )
    )
    .filter((recipe) =>
      category && category !== "All"
        ? recipe.categories.includes(category)
        : true
    )
    .map((recipe) => {
      const matchedIngredients = normalizedTerms.filter((term) =>
        recipe.normalizedIngredients.some(
          (ri) => ri.startsWith(term) || term.startsWith(ri)
        )
      );
      const missingIngredients = recipe.normalizedIngredients.filter(
        (ri) =>
          !normalizedTerms.some(
            (term) => ri.startsWith(term) || term.startsWith(ri)
          )
      );
      return {
        ...recipe,
        matchedIngredients,
        missingIngredients,
        matchCount: matchedIngredients.length,
        coverage:
          recipe.normalizedIngredients.length === 0
            ? 0
            : matchedIngredients.length / recipe.normalizedIngredients.length
      };
    })
    .sort(
      (left, right) =>
        right.matchCount - left.matchCount ||
        right.coverage - left.coverage ||
        left.title.localeCompare(right.title)
    );
}
```

Key differences from the old implementation:
- `{ title, ingredients }` → `{ terms }`
- `normalizedTerms.every(...)` replaces separate title filter + ingredients filter
- No more separate `matchCount > 0` gate — the `every()` already excludes non-matching recipes when `normalizedTerms.length > 0`

- [ ] **Step 5: Run the service tests — confirm they all pass**

```bash
npm test -- server/service.test.js
```

Expected: all 12 tests pass. Zero failures.

- [ ] **Step 6: Commit**

```bash
git add server/service.js server/service.test.js
git commit -m "refactor: unify filterRecipes to accept terms array instead of title+ingredients"
```

---

### Task 2: Update `server/http.js` and `server/http.test.js`

**Files:**
- Modify: `server/http.test.js`
- Modify: `server/http.js:35-46`

**Background:** The HTTP layer currently reads `title` and `ingredients` query params and passes them to `listRecipes`. Change it to read a single `q` param (comma-separated), split into an array, and pass as `terms`.

- [ ] **Step 1: Update the HTTP handler test**

Replace the body of the test `"returns recipe data without waiting for enrichment"` in `server/http.test.js`. The request now uses `q` and `listRecipes` is called with `terms`:

```js
it("returns recipe data without waiting for enrichment", async () => {
  const service = {
    refreshRecipes: vi.fn().mockResolvedValue({ usedCache: false, total: 1 }),
    enrichPendingRecipes: vi.fn().mockResolvedValue(undefined),
    listRecipes: vi.fn().mockReturnValue({
      usedCache: false,
      total: 1,
      enriched: 0,
      recipes: [
        {
          id: 1,
          title: "Aglio Olio",
          categories: [],
          enrichmentStatus: "pending"
        }
      ]
    })
  };

  const json = vi.fn();
  await createRecipesHandler(service)({ query: { q: "olio" } }, { json });

  expect(json).toHaveBeenCalledWith(
    expect.objectContaining({
      recipes: [
        expect.objectContaining({
          title: "Aglio Olio",
          enrichmentStatus: "pending"
        })
      ]
    })
  );
  expect(service.enrichPendingRecipes).toHaveBeenCalled();
  expect(service.listRecipes).toHaveBeenCalledWith({
    terms: ["olio"],
    category: undefined
  });
});
```

The second test `"keeps status responses unfiltered even when query params are present"` does not call `listRecipes`, so it needs no change.

- [ ] **Step 2: Run the HTTP tests — confirm the first test fails**

```bash
npm test -- server/http.test.js
```

Expected: 1 failure (the first test), 1 pass (the status test).

- [ ] **Step 3: Rewrite `parseRecipeFilters` in `server/http.js`**

Replace lines 35–46:

```js
function parseRecipeFilters(request) {
  return {
    terms: request.query?.q
      ? String(request.query.q)
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    category: request.query?.category
  };
}
```

- [ ] **Step 4: Run all tests — confirm they all pass**

```bash
npm test
```

Expected: all 57 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/http.js server/http.test.js
git commit -m "refactor: parse unified q param in HTTP layer instead of title+ingredients"
```

---

### Task 3: Update `src/App.jsx` and `src/styles.css`

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/styles.css`

**Background:** The React app currently has two state variables (`recipeSearch`, `ingredientChips`) and two input components (`SearchControls`). Replace them with a single `chips` array and a `UnifiedSearch` component. Each chip is one search term. Pressing Enter or clicking the Search button adds all comma-separated terms in the draft as chips. Removing all chips returns to the welcome state. The `buildRecipesUrl` helper sends `q` instead of `title`/`ingredients`.

- [ ] **Step 1: Replace `App` state and effects in `src/App.jsx`**

Replace the state declarations and the search effect. The full updated `App` function:

```jsx
export function App() {
  const [data, setData] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [chips, setChips] = useState([]);
  const [error, setError] = useState("");
  const inFlightRef = useRef(false);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId;

    async function loadStatus() {
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch("/api/recipes/status", {
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Unable to load recipes");
        const payload = await response.json();
        if (!cancelled) {
          setData((current) => ({
            ...payload,
            recipes: current?.recipes ?? []
          }));
          setError("");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
        }
      } finally {
        inFlightRef.current = false;
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }

    loadStatus();
    intervalId = window.setInterval(loadStatus, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (chips.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();

    async function loadResults() {
      try {
        const response = await fetch(
          buildRecipesUrl("/api/recipes", { chips, category: selectedCategory }),
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("Unable to load recipes");
        const payload = await response.json();
        if (!cancelled) {
          setData(payload);
          setError("");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      }
    }

    loadResults();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [chips, selectedCategory]);

  const categories = useMemo(() => {
    if (!data?.recipes) return [];
    const values = new Set(data.recipes.flatMap((recipe) => recipe.categories));
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const visibleRecipes = data?.recipes ?? [];

  function addChips(newTerms) {
    setChips((current) => [
      ...current,
      ...newTerms.filter((term) => !current.includes(term))
    ]);
  }

  function removeChip(chip) {
    setChips((current) => {
      const next = current.filter((c) => c !== chip);
      if (next.length === 0) {
        setData((d) => (d ? { ...d, recipes: [] } : d));
        setSelectedCategory("All");
      }
      return next;
    });
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <h1>Find a meal from the recipe archive</h1>
        {data ? (
          <p className="status">{data.total} recipes ready</p>
        ) : (
          <p className="status">Loading recipes…</p>
        )}
      </header>

      {data?.usedCache ? (
        <p className="notice">
          Showing cached recipe data while Riverford is unavailable.
        </p>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {data ? (
        <>
          <UnifiedSearch onAddChips={addChips} />

          {chips.length > 0 ? (
            <div className="search-chips" aria-label="Search terms">
              {chips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => removeChip(chip)}
                  type="button"
                  aria-label={`Remove ${chip}`}
                >
                  {chip}
                </button>
              ))}
            </div>
          ) : null}

          {chips.length === 0 ? (
            <section className="welcome-state">
              <div className="welcome-mark" aria-hidden="true">
                ✦
              </div>
              <div>
                <h2>Search by recipe name or ingredient.</h2>
                <p>We'll only show matches once you search.</p>
                <div className="welcome-steps" aria-hidden="true">
                  <span>Type a term</span>
                  <span>Press Enter</span>
                  <span>See matches</span>
                </div>
              </div>
            </section>
          ) : (
            <>
              <nav className="filters" aria-label="Recipe categories">
                {["All", ...categories].map((category) => (
                  <button
                    className={category === selectedCategory ? "active" : ""}
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    type="button"
                  >
                    {category}
                  </button>
                ))}
              </nav>

              <section className="recipe-grid" aria-label="Recipes">
                {visibleRecipes.length === 0 ? (
                  <p className="empty-state">No recipes match that search.</p>
                ) : null}
                {visibleRecipes.map((recipe) => (
                  <article className="recipe-card" key={recipe.id}>
                    <h2>
                      <a href={recipe.url} rel="noreferrer" target="_blank">
                        {recipe.title}
                      </a>
                    </h2>
                    {recipe.cookTime || recipe.servings ? (
                      <div className="recipe-meta">
                        {recipe.cookTime ? (
                          <span>{formatCookTime(recipe.cookTime)}</span>
                        ) : null}
                        {recipe.servings ? (
                          <span>Serves {recipe.servings}</span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="tag-row">
                      {recipe.categories.length > 0 ? (
                        [...new Set(recipe.categories)].map((category) => (
                          <span key={category}>{category}</span>
                        ))
                      ) : (
                        <span className="muted">Loading recipe details…</span>
                      )}
                    </div>
                    {recipe.matchCount ? (
                      <>
                        <p className="matches">
                          You have {recipe.matchCount} of{" "}
                          {recipe.normalizedIngredients.length} ingredients
                        </p>
                        <p className="matches matched">
                          Matched: {recipe.matchedIngredients.join(", ")}
                        </p>
                        {recipe.missingIngredients.length > 0 ? (
                          <p className="matches missing">
                            Missing: {recipe.missingIngredients.join(", ")}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </article>
                ))}
              </section>
            </>
          )}
        </>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 2: Replace `SearchControls` with `UnifiedSearch` in `src/App.jsx`**

Delete the `SearchControls` function entirely and replace with:

```jsx
function UnifiedSearch({ onAddChips }) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const terms = normalizeIngredientQuery(draft);
    if (terms.length === 0) return;
    onAddChips(terms);
    setDraft("");
  }

  return (
    <label className="unified-search">
      <span>Search recipes or ingredients</span>
      <span className="unified-search-controls">
        <input
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            }
          }}
          placeholder="pasta, chicken, soup…"
          type="text"
          value={draft}
        />
        <button onClick={commitDraft} type="button">
          Search
        </button>
      </span>
    </label>
  );
}
```

`normalizeIngredientQuery` (already imported from `./matching.js`) splits by comma and lowercases — exactly the split behaviour we want.

- [ ] **Step 3: Replace `buildRecipesUrl` in `src/App.jsx`**

Delete the old `buildRecipesUrl` and replace with:

```js
function buildRecipesUrl(endpoint, { chips, category }) {
  const params = new URLSearchParams();
  if (chips.length > 0) params.set("q", chips.join(","));
  if (category !== "All") params.set("category", category);
  const query = params.toString();
  return query ? `${endpoint}?${query}` : endpoint;
}
```

- [ ] **Step 4: Update CSS in `src/styles.css`**

Replace the `.recipe-search`, `.ingredient-search`, `.recipe-search-controls`, `.ingredient-controls` blocks and the `@media` overrides with a single `.unified-search` block. Also rename `.ingredient-chips` to `.search-chips`.

Find and replace:

```css
/* REMOVE these selectors entirely: */
.recipe-search,
.ingredient-search { ... }

.recipe-search span,
.ingredient-search span { ... }

.recipe-search input,
.ingredient-search input { ... }

.recipe-search input { ... }

.ingredient-search input { ... }

.recipe-search-controls,
.ingredient-controls { ... }

.recipe-search-controls { ... }

.recipe-search-controls button,
.ingredient-controls button { ... }

.ingredient-chips { ... }

.ingredient-chips button { ... }

/* And in the @media block: */
.recipe-search-controls,
.ingredient-controls { ... }

.recipe-search-controls button,
.ingredient-controls button { ... }
```

Add in their place (after the `.hero` block, before `.filters`):

```css
.unified-search {
  display: grid;
  gap: 8px;
  margin: 22px 0 14px;
}

.unified-search span {
  color: #62705f;
  font-size: 0.9rem;
}

.unified-search-controls {
  display: flex;
  align-items: stretch;
  gap: 10px;
  width: 100%;
}

.unified-search input {
  flex: 1;
  border: 1px solid rgba(33, 49, 37, 0.14);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.82);
  padding: 14px 16px;
  color: #213125;
  font: inherit;
}

.unified-search-controls button {
  border: 0;
  border-radius: 16px;
  background: #213125;
  padding: 0 16px;
  color: #f6f3ec;
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.search-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.search-chips button {
  border: 0;
  border-radius: 999px;
  background: #213125;
  padding: 8px 12px;
  color: #f6f3ec;
  cursor: pointer;
}

@media (max-width: 640px) {
  .unified-search-controls {
    display: grid;
  }

  .unified-search-controls button {
    min-height: 48px;
  }
}
```

Also remove the `.example-ingredients` block if present — it is not used in the updated UI.

- [ ] **Step 5: Verify the app runs without JS errors**

```bash
npm run dev
```

Open the app in the browser. Verify:
- Single search input visible with placeholder "pasta, chicken, soup…"
- Typing "pasta" and pressing Enter creates a "pasta" chip and triggers a fetch to `/api/recipes?q=pasta`
- Typing "pasta, chicken" and pressing Enter creates two chips: "pasta" and "chicken"
- Clicking a chip's ✕ removes it; removing the last chip returns to the welcome screen
- Category filter buttons still appear after searching and still work

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/styles.css
git commit -m "feat: replace two search bars with unified chip-based search"
```

---

### Task 4: Update `src/App.test.jsx`

**Files:**
- Modify: `src/App.test.jsx`

**Background:** The tests mock the API via a `filterPayload` helper and a `loadAllRecipes` helper. Both need rewriting. `filterPayload` now parses `q` instead of `title`/`ingredients`. `loadAllRecipes` is removed — each test adds its own first chip (there is no longer a way to show all recipes without searching). Tests that used two separate inputs now use the single unified input.

- [ ] **Step 1: Replace the `filterPayload` and `loadAllRecipes` helpers**

At the top of `src/App.test.jsx`, replace `filterPayload` and `loadAllRecipes` with:

```js
function filterPayload(payload, url) {
  const params = new URL(url, "http://localhost").searchParams;
  const category = params.get("category");
  const terms = (params.get("q") ?? "")
    .split(",")
    .filter(Boolean)
    .map((t) => t.trim().toLowerCase())
    .map(normalizeIngredient);

  const recipes = payload.recipes
    .map((recipe) => {
      const normalizedIngredients = normalizeRecipeIngredients(
        recipe.ingredients ?? []
      );
      const matchedIngredients = terms.filter((term) =>
        normalizedIngredients.some(
          (ri) => ri.startsWith(term) || term.startsWith(ri)
        )
      );
      return {
        ...recipe,
        normalizedIngredients,
        matchedIngredients,
        missingIngredients: normalizedIngredients.filter(
          (ri) =>
            !terms.some((term) => ri.startsWith(term) || term.startsWith(ri))
        ),
        matchCount: matchedIngredients.length
      };
    })
    .filter((recipe) =>
      terms.length > 0
        ? terms.every(
            (term) =>
              recipe.title.toLowerCase().includes(term) ||
              recipe.normalizedIngredients.some(
                (ri) => ri.startsWith(term) || term.startsWith(ri)
              )
          )
        : true
    )
    .filter((recipe) =>
      category ? recipe.categories.includes(category) : true
    )
    .sort(
      (left, right) =>
        right.matchCount - left.matchCount ||
        left.title.localeCompare(right.title)
    );

  return { ...payload, recipes };
}

async function searchFor(term) {
  const input = await screen.findByRole("textbox", { name: /search/i });
  await userEvent.type(input, `${term}{enter}`);
}
```

`searchFor` replaces `loadAllRecipes`. Each test calls `searchFor("some term")` to enter the searched state. The term should be something that matches all recipes the test expects to see.

Note: `normalizeIngredient` is already imported at the top of the file — no import change needed.

- [ ] **Step 2: Update each test — rewrite all tests that used `loadAllRecipes` or check old welcome text**

Also update the test `"loads only status initially and does not render recipes before a search"` — the welcome heading changed. Replace:

```js
expect(
  screen.getByText(/start with a recipe name or a few ingredients/i)
).toBeInTheDocument();
```

with:

```js
expect(
  screen.getByText(/search by recipe name or ingredient/i)
).toBeInTheDocument();
```

Replace the body of every test below. Tests not listed here (`"loads only status initially..."`, `"shows a loading state..."`, `"does not start a new poll..."`, `"aborts an in-flight request..."`) need no changes.

**Test: `"shows cached data notice and Riverford recipe links"`**

```js
it("shows cached data notice and Riverford recipe links", async () => {
  mockFetch({
    usedCache: true,
    total: 1,
    enriched: 1,
    recipes: [
      {
        id: 1,
        title: "Aglio Olio",
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        categories: ["Veg"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);

  expect(
    await screen.findByText(/showing cached recipe data/i)
  ).toBeInTheDocument();
  await searchFor("aglio");
  expect(screen.getByRole("link", { name: "Aglio Olio" })).toHaveAttribute(
    "href",
    "https://www.riverford.co.uk/recipes/aglio-olio"
  );
});
```

**Test: `"uses user-friendly loading text for recipes without details yet"`**

```js
it("uses user-friendly loading text for recipes without details yet", async () => {
  mockFetch({
    usedCache: false,
    total: 1,
    enriched: 0,
    recipes: [
      {
        id: 1,
        title: "Aglio Olio",
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        categories: [],
        enrichmentStatus: "pending"
      }
    ]
  });

  render(<App />);
  await searchFor("aglio");
  expect(await screen.findByText(/loading recipe details/i)).toBeInTheDocument();
});
```

**Test: `"filters recipes by category"`**

```js
it("filters recipes by category", async () => {
  mockFetch({
    usedCache: false,
    total: 2,
    enriched: 2,
    recipes: [
      {
        id: 1,
        title: "Aglio Olio",
        url: "https://www.riverford.co.uk/recipes/aglio-olio",
        categories: ["Veg"],
        enrichmentStatus: "enriched"
      },
      {
        id: 2,
        title: "Poached Chicken",
        url: "https://www.riverford.co.uk/recipes/poached-chicken",
        categories: ["Chicken"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);
  await searchFor("aglio");
  await screen.findByText("Aglio Olio");

  await userEvent.click(screen.getByRole("button", { name: "Chicken" }));

  await waitFor(() => {
    expect(screen.queryByText("Aglio Olio")).not.toBeInTheDocument();
  });
});
```

**Test: `"loads visible recipes only after title search is committed"`**

```js
it("loads visible recipes only after title search is committed", async () => {
  global.fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usedCache: false,
        total: 2,
        enriched: 2
      })
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usedCache: false,
        total: 2,
        enriched: 2,
        recipes: [
          {
            id: 1,
            title: "Aglio Olio",
            url: "https://www.riverford.co.uk/recipes/aglio-olio",
            categories: ["Veg"],
            enrichmentStatus: "enriched"
          },
          {
            id: 2,
            title: "Poached Chicken",
            url: "https://www.riverford.co.uk/recipes/poached-chicken",
            categories: ["Chicken"],
            enrichmentStatus: "enriched"
          }
        ]
      })
    });

  render(<App />);
  await screen.findByText(/2 recipes ready/i);

  const input = screen.getByRole("textbox", { name: /search/i });
  await userEvent.type(input, "chicken");

  expect(screen.queryByText("Aglio Olio")).not.toBeInTheDocument();

  await userEvent.type(input, "{enter}");

  expect(await screen.findByText("Poached Chicken")).toBeInTheDocument();
});
```

**Test: `"renders repeated categories only once per recipe card"`**

```js
it("renders repeated categories only once per recipe card", async () => {
  mockFetch({
    usedCache: false,
    total: 1,
    enriched: 1,
    recipes: [
      {
        id: 1,
        title: "Quick Supper",
        url: "https://www.riverford.co.uk/recipes/quick-supper",
        categories: ["Quick ideas", "Quick ideas"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);
  await searchFor("quick");
  await screen.findByText("Quick Supper");

  expect(screen.getAllByText("Quick ideas")).toHaveLength(2);
});
```

**Test: `"does not update ingredient results until ingredients are confirmed"`**

```js
it("does not update results until search term is confirmed", async () => {
  mockFetch({
    usedCache: false,
    total: 2,
    enriched: 2,
    recipes: [
      {
        id: 1,
        title: "Carrot Soup",
        url: "https://www.riverford.co.uk/recipes/carrot-soup",
        categories: ["Soup"],
        ingredients: ["carrots", "stock"],
        enrichmentStatus: "enriched"
      },
      {
        id: 2,
        title: "Chicken Stew",
        url: "https://www.riverford.co.uk/recipes/chicken-stew",
        categories: ["Chicken"],
        ingredients: ["chicken", "carrots", "leeks"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);
  await searchFor("carrot");
  await screen.findByText("Carrot Soup");

  const input = screen.getByRole("textbox", { name: /search/i });
  await userEvent.type(input, "chicken");

  expect(screen.getByText("Carrot Soup")).toBeInTheDocument();

  await userEvent.type(input, "{enter}");

  await waitFor(() => {
    expect(screen.queryByText("Carrot Soup")).not.toBeInTheDocument();
  });
  expect(screen.getByText("Chicken Stew")).toBeInTheDocument();
});
```

Explanation: "carrot" chip shows Carrot Soup. Typing "chicken" (without Enter) leaves Carrot Soup visible. Pressing Enter adds "chicken" chip; now both terms must match — Chicken Stew has carrot (ingredient) and chicken (title+ingredient) so it passes, Carrot Soup has no chicken so it's filtered out.

**Test: `"combines title search with existing filters"`**

```js
it("combines search chips with category filter", async () => {
  mockFetch({
    usedCache: false,
    total: 3,
    enriched: 3,
    recipes: [
      {
        id: 1,
        title: "Chicken Soup",
        url: "https://www.riverford.co.uk/recipes/chicken-soup",
        categories: ["Soup"],
        ingredients: ["chicken", "stock"],
        enrichmentStatus: "enriched"
      },
      {
        id: 2,
        title: "Chicken Pie",
        url: "https://www.riverford.co.uk/recipes/chicken-pie",
        categories: ["Main"],
        ingredients: ["chicken", "pastry"],
        enrichmentStatus: "enriched"
      },
      {
        id: 3,
        title: "Carrot Soup",
        url: "https://www.riverford.co.uk/recipes/carrot-soup",
        categories: ["Soup"],
        ingredients: ["carrots", "stock"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);
  await searchFor("chicken");
  await screen.findByText("Chicken Soup");

  await userEvent.click(screen.getByRole("button", { name: "Soup" }));

  await waitFor(() => {
    expect(screen.queryByText("Chicken Pie")).not.toBeInTheDocument();
  });

  const input = screen.getByRole("textbox", { name: /search/i });
  await userEvent.type(input, "stock{enter}");

  await waitFor(() => {
    expect(screen.queryByText("Carrot Soup")).not.toBeInTheDocument();
  });
  expect(screen.getByText("Chicken Soup")).toBeInTheDocument();
});
```

**Test: `"shows an empty state only after an ingredient search is confirmed"`**

```js
it("shows an empty state only after a search term is confirmed", async () => {
  mockFetch({
    usedCache: false,
    total: 1,
    enriched: 1,
    recipes: [
      {
        id: 1,
        title: "Carrot Soup",
        url: "https://www.riverford.co.uk/recipes/carrot-soup",
        categories: ["Soup"],
        ingredients: ["carrots", "stock"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);
  await searchFor("carrot");
  await screen.findByText("Carrot Soup");

  const input = screen.getByRole("textbox", { name: /search/i });
  await userEvent.type(input, "salmon");

  expect(screen.queryByText(/no recipes match/i)).not.toBeInTheDocument();

  await userEvent.type(input, "{enter}");

  expect(await screen.findByText(/no recipes match that search/i)).toBeInTheDocument();
});
```

**Test: `"keeps the original non-pantry user terms in the match explanation"`**

```js
it("keeps the original non-pantry user terms in the match explanation", async () => {
  mockFetch({
    usedCache: false,
    total: 1,
    enriched: 1,
    recipes: [
      {
        id: 1,
        title: "Tomato Soup",
        url: "https://www.riverford.co.uk/recipes/tomato-soup",
        categories: ["Soup"],
        ingredients: ["1 tomato", "olive oil"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);
  await searchFor("tomatoes");

  expect(await screen.findByText(/matched: tomato/i)).toBeInTheDocument();
});
```

**Test: `"adds ingredient chips with Enter and removes them with their buttons"`**

```js
it("adds search chips with Enter and removes them with their buttons", async () => {
  mockFetch({
    usedCache: false,
    total: 1,
    enriched: 1,
    recipes: [
      {
        id: 1,
        title: "Carrot Soup",
        url: "https://www.riverford.co.uk/recipes/carrot-soup",
        categories: ["Soup"],
        ingredients: ["carrots"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);
  await screen.findByText(/recipes ready/i);

  const input = screen.getByRole("textbox", { name: /search/i });
  await userEvent.type(input, "carrot{enter}");

  expect(screen.getByRole("button", { name: /remove carrot/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /remove carrot/i }));

  expect(
    screen.getByText(/search by recipe name or ingredient/i)
  ).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: /recipes/i })).not.toBeInTheDocument();
});
```

**Test: `"adds ingredient chips with the add ingredient button"`**

```js
it("adds search chips with the Search button", async () => {
  mockFetch({
    usedCache: false,
    total: 1,
    enriched: 1,
    recipes: [
      {
        id: 1,
        title: "Carrot Soup",
        url: "https://www.riverford.co.uk/recipes/carrot-soup",
        categories: ["Soup"],
        ingredients: ["carrots"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);
  await screen.findByText(/recipes ready/i);

  await userEvent.type(
    screen.getByRole("textbox", { name: /search/i }),
    "carrot"
  );
  await userEvent.click(screen.getByRole("button", { name: /^search$/i }));

  expect(screen.getByRole("button", { name: /remove carrot/i })).toBeInTheDocument();
});
```

**Test: `"accepts pasted comma-separated ingredients as chips"`**

```js
it("accepts comma-separated input as multiple chips", async () => {
  mockFetch({
    usedCache: false,
    total: 1,
    enriched: 1,
    recipes: [
      {
        id: 1,
        title: "Tomato Soup",
        url: "https://www.riverford.co.uk/recipes/tomato-soup",
        categories: ["Soup"],
        ingredients: ["tomatoes", "olive oil"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);
  await screen.findByText(/recipes ready/i);

  const input = screen.getByRole("textbox", { name: /search/i });
  await userEvent.type(input, "tomatoes, soup{enter}");

  expect(screen.getByRole("button", { name: /remove tomatoes/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /remove soup/i })).toBeInTheDocument();
});
```

**Test: `"shows matched and missing ingredients for ranked recipes"`**

```js
it("shows matched and missing ingredients for ranked recipes", async () => {
  mockFetch({
    usedCache: false,
    total: 1,
    enriched: 1,
    recipes: [
      {
        id: 1,
        title: "Chicken Soup",
        url: "https://www.riverford.co.uk/recipes/chicken-soup",
        categories: ["Soup"],
        ingredients: ["chicken", "carrots", "stock"],
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);

  const input = await screen.findByRole("textbox", { name: /search/i });
  await userEvent.type(input, "chicken, carrot{enter}");

  expect(await screen.findByText(/you have 2 of 3 ingredients/i)).toBeInTheDocument();
  expect(screen.getByText(/missing: stock/i)).toBeInTheDocument();
});
```

**Test: `"shows cook time and serving count when available"`**

```js
it("shows cook time and serving count when available", async () => {
  mockFetch({
    usedCache: false,
    total: 1,
    enriched: 1,
    recipes: [
      {
        id: 1,
        title: "Chicken Soup",
        url: "https://www.riverford.co.uk/recipes/chicken-soup",
        categories: ["Soup"],
        ingredients: ["chicken"],
        cookTime: "PT45M",
        servings: "4",
        enrichmentStatus: "enriched"
      }
    ]
  });

  render(<App />);
  await searchFor("chicken");
  await screen.findByText("Chicken Soup");

  expect(screen.getByText("45 min")).toBeInTheDocument();
  expect(screen.getByText("Serves 4")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all 57 tests pass. Zero failures.

If any test fails, check:
- The `textbox` query name — it matches the `<span>` label text inside the `<label>`. With `<span>Search recipes or ingredients</span>`, `getByRole("textbox", { name: /search/i })` will match.
- The welcome text — the new copy is "Search by recipe name or ingredient." so update any `queryByText` checks accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/App.test.jsx
git commit -m "test: update App tests for unified search UI"
```
