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
      const startedAt = Date.now();
      console.log(
        `[refresh] Starting sitemap refresh (ttlMs=${REFRESH_TTL_MS}, lastRefreshedAt=${lastRefreshedAt || "never"})`
      );
      try {
        const sitemap = await fetchText(SITEMAP_URL);
        const recipes = parseSitemap(sitemap).map((url) => ({
          url,
          title: deriveTitleFromUrl(url)
        }));
        console.log(`[refresh] Parsed ${recipes.length} recipe URLs from sitemap`);
        store.upsertRecipes(recipes);
        usedCache = false;
        lastRefreshedAt = Date.now();
        console.log(
          `[refresh] Upsert complete; cache flag set to false (elapsedMs=${Date.now() - startedAt})`
        );
        return { usedCache: false, total: recipes.length };
      } catch (error) {
        const recipes = store.listRecipes();
        usedCache = recipes.length > 0;
        lastRefreshedAt = Date.now();
        console.warn(
          `[refresh] Failed to fetch sitemap; using local cache (${recipes.length} recipes)`,
          error
        );
        return { usedCache, total: recipes.length };
      }
    })().finally(() => {
      console.log("[refresh] Refresh run finished");
      refreshPromise = null;
    });

    return refreshPromise;
  }

  return {
    async refreshRecipes({ force = false } = {}) {
      const recipes = store.listRecipes();
      const hasData = recipes.length > 0;
      const isStale = Date.now() - lastRefreshedAt > REFRESH_TTL_MS;
      console.log(
        `[refresh] Triggered refreshRecipes(hasData=${hasData}, total=${recipes.length}, isStale=${isStale}, force=${force})`
      );

      if (force) {
        console.log("[refresh] Forced refresh requested; running sitemap refresh now");
        return doRefresh();
      }

      if (hasData && !isStale) {
        console.log("[refresh] Returning cached in-memory data inside TTL window");
        return { usedCache, total: recipes.length };
      }

      if (hasData) {
        // Trigger background refresh; return current data without blocking.
        console.log("[refresh] Scheduling background sitemap refresh");
        doRefresh();
        return { usedCache, total: recipes.length };
      }

      // Store empty — must wait for the sitemap before we can return anything.
      console.log("[refresh] Store empty; waiting for sitemap refresh to complete");
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
        const startedAt = Date.now();
        const pendingUrls = store.listPendingRecipeUrls();
        console.log(
          `[enrich] Starting enrichment for ${pendingUrls.length} pending recipes`
        );
        let enrichedCount = 0;
        let failedCount = 0;
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
            enrichedCount += 1;
            if (enrichedCount % 50 === 0 || enrichedCount === pendingUrls.length) {
              console.log(
                `[enrich] Progress ${enrichedCount}/${pendingUrls.length}`
              );
            }
          } catch {
            // Leave pending so a later refresh can try again.
            failedCount += 1;
            console.warn(`[enrich] Failed to enrich ${url}; leaving as pending`);
          }
        }
        console.log(
          `[enrich] Enrichment run finished (${enrichedCount}/${pendingUrls.length} succeeded, failed=${failedCount}, elapsedMs=${Date.now() - startedAt})`
        );
        return this.listRecipes();
      })().finally(() => {
        enrichmentPromise = null;
      });

      return enrichmentPromise;
    },
    async requestRecipeRefresh({ urls = [], force = false } = {}) {
      const uniqueUrls = [...new Set(urls.filter(Boolean))];
      console.log(
        `[refresh] requestRecipeRefresh received ${uniqueUrls.length} url(s), force=${force}`
      );
      if (uniqueUrls.length > 0) {
        store.markRefreshRequested(uniqueUrls);
      }
      return this.getStatus();
    }
  };
}

function filterRecipes(recipes, { terms = [], category } = {}) {
  const normalizedTerms = [
    ...new Set(terms.map(normalizeIngredient).map(normalizeMatchTerm).filter(Boolean))
  ];

  return recipes
    .filter((recipe) =>
      normalizedTerms.length === 0 ||
      normalizedTerms.every(
        (term) =>
          recipe.title.toLowerCase().includes(term) ||
          recipe.normalizedIngredients.some(
            (ri) => ingredientMatchesTerm(ri, term)
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
          (ri) => ingredientMatchesTerm(ri, term)
        )
      );
      const missingIngredients = recipe.normalizedIngredients.filter(
        (ri) =>
          !normalizedTerms.some(
            (term) => ingredientMatchesTerm(ri, term)
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

function normalizeMatchTerm(value = "") {
  return /\bstock\b/.test(value) ? "stock" : value;
}

function ingredientMatchesTerm(recipeIngredient, term) {
  const normalizedRecipeIngredient = normalizeMatchTerm(recipeIngredient);
  return (
    normalizedRecipeIngredient.startsWith(term) ||
    term.startsWith(normalizedRecipeIngredient)
  );
}
