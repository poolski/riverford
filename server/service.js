import {
  deriveTitleFromUrl,
  extractRecipeMetadata,
  parseSitemap
} from "./recipes.js";
import {
  normalizeIngredient,
  normalizeRecipeIngredients
} from "./ingredients.js";

const SITEMAP_URL = "https://www.riverford.co.uk/recipes.xml";
const REFRESH_TTL_MS = 5 * 60 * 1000;

export function createRecipeService({ store, fetchText }) {
  let usedCache = false;
  let enrichmentPromise = null;
  let refreshPromise = null;
  let lastRefreshedAt = 0;

  function doRefresh() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      try {
        const sitemap = await fetchText(SITEMAP_URL);
        const recipes = parseSitemap(sitemap).map((url) => ({
          url,
          title: deriveTitleFromUrl(url)
        }));
        store.upsertRecipes(recipes);
        usedCache = false;
        lastRefreshedAt = Date.now();
        return { usedCache: false, total: recipes.length };
      } catch {
        const recipes = store.listRecipes();
        usedCache = recipes.length > 0;
        lastRefreshedAt = Date.now();
        return { usedCache, total: recipes.length };
      }
    })().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  return {
    async refreshRecipes() {
      const recipes = store.listRecipes();
      const hasData = recipes.length > 0;
      const isStale = Date.now() - lastRefreshedAt > REFRESH_TTL_MS;

      if (hasData && !isStale) {
        return { usedCache, total: recipes.length };
      }

      if (hasData) {
        // Trigger background refresh; return current data without blocking.
        doRefresh();
        return { usedCache, total: recipes.length };
      }

      // Store empty — must wait for the sitemap before we can return anything.
      return doRefresh();
    },
    listRecipes(filters = {}) {
      const recipes = filterRecipes(store.listRecipes(), filters);
      return {
        usedCache,
        total: recipes.length,
        enriched: recipes.filter(
          (recipe) => recipe.enrichmentStatus === "enriched"
        ).length,
        recipes
      };
    },
    getStatus() {
      const recipes = store.listRecipes();
      return {
        usedCache,
        total: recipes.length,
        enriched: recipes.filter(
          (recipe) => recipe.enrichmentStatus === "enriched"
        ).length
      };
    },
    enrichPendingRecipes() {
      if (enrichmentPromise) return enrichmentPromise;

      enrichmentPromise = (async () => {
        const pendingUrls = store.listPendingRecipeUrls();
        for (const url of pendingUrls) {
          try {
            const html = await fetchText(url);
            const metadata = extractRecipeMetadata(html);
            store.updateMetadata(url, {
              ...metadata,
              normalizedIngredients: normalizeRecipeIngredients(
                metadata.ingredients
              )
            });
          } catch {
            // Leave pending so a later refresh can try again.
          }
        }
        return this.listRecipes();
      })().finally(() => {
        enrichmentPromise = null;
      });

      return enrichmentPromise;
    }
  };
}

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
