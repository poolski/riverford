# Saved Page and Recipe Image Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated saved-items page, expose it from the desktop header and mobile toolbar, and make recipe images open the source recipe URL.

**Architecture:** The app will keep using the current client-side route handling with `window.history.pushState` and `popstate`. The saved page will reuse the existing recipe card component so the main grid and saved grid stay visually consistent, and the recipe image will become a second link target alongside the title. Desktop will expose the Saved page as a small top-row link; mobile will keep Saved in the bottom action bar with Search and Categories.

**Tech Stack:** React, CSS, Vitest, Testing Library, browser verification in the Codex in-app browser

---

### Task 1: Add saved-page routing and shared card link behavior

**Files:**
- Modify: `/Users/kyrill/Dev/personal/riverford-recipes/src/App.jsx`
- Test: `/Users/kyrill/Dev/personal/riverford-recipes/src/App.test.jsx`

- [ ] **Step 1: Write the failing tests**

```javascript
it("renders the saved page at /saved", async () => {
  window.history.pushState({}, "", "/saved");

  mockFetch({
    usedCache: false,
    total: 2,
    enriched: 2,
    savedRecipeIds: [1],
    recipes: [
      {
        id: 1,
        title: "Saved Salad",
        url: "https://example.com/saved-salad",
        categories: ["Salads"],
        ingredients: ["lettuce"],
        cookTime: "PT10M",
        servings: "2"
      },
      {
        id: 2,
        title: "Unsaved Roast",
        url: "https://example.com/unsaved-roast",
        categories: ["Main"],
        ingredients: ["beef"],
        cookTime: "PT2H",
        servings: "4"
      }
    ]
  });

  render(<App />);

  expect(await screen.findByRole("heading", { name: /saved recipes/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Saved Salad" })).toHaveAttribute(
    "href",
    "https://example.com/saved-salad"
  );
  expect(screen.queryByRole("link", { name: "Unsaved Roast" })).not.toBeInTheDocument();
});

it("opens the recipe image as a link to the recipe url", async () => {
  mockFetch({
    usedCache: false,
    total: 1,
    enriched: 1,
    recipes: [
      {
        id: 1,
        title: "Image Link Soup",
        url: "https://example.com/image-link-soup",
        image: "https://images.example.com/soup.jpg",
        categories: ["Soup"],
        ingredients: ["stock"],
        cookTime: "PT20M",
        servings: "2"
      }
    ]
  });

  render(<App />);
  await screen.findByRole("link", { name: "Image Link Soup" });

  expect(
    screen.getByRole("link", { name: /image link soup/i })
  ).toHaveAttribute("href", "https://example.com/image-link-soup");
});
```

- [ ] **Step 2: Run the tests and confirm they fail for the expected reason**

Run: `npm test -- src/App.test.jsx -- --runInBand`

Expected: the new saved-page and image-link assertions fail because `/saved` is not rendered yet and the image is not a link.

- [ ] **Step 3: Implement the routing and shared card link**

```javascript
const isSavedPage = currentPath === "/saved";
const savedRecipes = useMemo(
  () => visibleRecipes.filter((recipe) => savedRecipeIds.includes(recipe.id)),
  [visibleRecipes, savedRecipeIds]
);
const displayedSavedRecipes = useMemo(
  () => applyClientFilters(savedRecipes, filters),
  [savedRecipes, filters]
);

function RecipeCard({ recipe, isSaved, onToggleSave }) {
  return (
    <article className={`recipe-card${recipe.image ? " has-image" : ""}`}>
      <a className="recipe-card-media-link" href={recipe.url} rel="noreferrer" target="_blank" aria-label={recipe.title}>
        {recipe.image ? (
          <div
            className="recipe-card-media"
            aria-hidden="true"
            style={{ "--card-image": `url(${recipe.image})` }}
          />
        ) : (
          <div className="recipe-card-media recipe-card-media-fallback" aria-hidden="true">
            <span>{(recipe.title ?? "R").slice(0, 1)}</span>
          </div>
        )}
      </a>
      ...
    </article>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/App.test.jsx -- --runInBand`

Expected: the new route and image-link tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/App.test.jsx
git commit -m "feat: add saved page routing"
```

### Task 2: Add navigation entry points and saved-page styling

**Files:**
- Modify: `/Users/kyrill/Dev/personal/riverford-recipes/src/App.jsx`
- Modify: `/Users/kyrill/Dev/personal/riverford-recipes/src/styles.css`
- Test: `/Users/kyrill/Dev/personal/riverford-recipes/src/App.test.jsx`

- [ ] **Step 1: Write the failing tests**

```javascript
it("shows a Saved link in the desktop header", async () => {
  render(<App />);
  expect(await screen.findByRole("button", { name: "Saved" })).toBeInTheDocument();
});

it("shows a Saved quick action in the mobile toolbar", async () => {
  render(<App />);
  expect(await screen.findByRole("button", { name: /saved items/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests and confirm they fail for the expected reason**

Run: `npm test -- src/App.test.jsx -- --runInBand`

Expected: the Saved entry-point assertions fail because the link/button is not yet rendered.

- [ ] **Step 3: Implement the desktop and mobile navigation**

```javascript
function BottomActions({ onSearchClick, onCategoriesClick, currentPath, navigateTo }) {
  return (
    <nav className="mobile-action-bar" aria-label="Quick actions">
      ...
      <button type="button" className={`saved${savedActive ? " active" : ""}`} onClick={() => navigateTo("/saved")}>
        <HeartMark />
        <span>Saved</span>
      </button>
    </nav>
  );
}

<button
  type="button"
  className={`saved-page-link${isSavedPage ? " active" : ""}`}
  onClick={() => navigateTo("/saved")}
>
  Saved
</button>
```

```css
.saved-page-link {
  border: 1px solid rgba(109, 84, 183, 0.12);
  border-radius: 999px;
  background: rgba(255, 250, 245, 0.9);
  padding: 9px 14px;
  color: var(--text);
  font-weight: 700;
}

.saved-page-link.active {
  background: var(--primary);
  color: #fffdfb;
}

.saved-page {
  margin-top: 18px;
}

.saved-empty {
  margin-top: 18px;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/App.test.jsx -- --runInBand`

Expected: the Saved navigation tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/styles.css src/App.test.jsx
git commit -m "feat: add saved navigation"
```

### Task 3: Verify the browser behavior and finish the branch

**Files:**
- Verify: `/Users/kyrill/Dev/personal/riverford-recipes/src/App.jsx`
- Verify: `/Users/kyrill/Dev/personal/riverford-recipes/src/styles.css`

- [ ] **Step 1: Run the full targeted test suite**

Run: `npm test -- src/App.test.jsx`

Expected: all App tests pass.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: build completes successfully.

- [ ] **Step 3: Check the rendered app in the in-app browser**

Verify on mobile width:
- the bottom toolbar shows Search, Categories, and Saved
- tapping Saved opens `/saved`
- recipe images open the recipe URL in a new tab

Verify on desktop width:
- the Saved link appears in the hero/top row
- the saved page shows a recipe grid, not a separate card style

- [ ] **Step 4: Commit any final polish**

```bash
git add src/App.jsx src/App.test.jsx src/styles.css
git commit -m "feat: finish saved page links"
```

---

### Self-review

**Spec coverage**
- Saved-page route: Task 1
- Recipe grid reuse on saved page: Task 1
- Image-as-link behavior: Task 1
- Mobile toolbar Saved entry: Task 2
- Desktop Saved link: Task 2
- Styling for saved page and link states: Task 2
- Verification in browser and build: Task 3

**Placeholder scan**
- No TBD/TODO placeholders
- No undefined helpers or nonexistent files

**Type consistency**
- Route state uses `currentPath` and `navigateTo`, matching the current app structure
- Saved recipe filtering uses existing `savedRecipeIds` and `recipe.id`
- Recipe image links use `recipe.url`, which already exists on the recipe model
