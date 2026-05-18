import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { normalizeIngredientQuery } from "./matching.js";

const SEARCH_STATE_STORAGE_KEY =
  import.meta.env.MODE === "test"
    ? "riverford.searchState.test.v1"
    : "riverford.searchState.v1";

export function App() {
  const batchSize = 20;
  const initialSearchState = loadSearchState();
  const [currentPath, setCurrentPath] = useState(getCurrentPath());
  const [data, setData] = useState(null);
  const [indexedTotal, setIndexedTotal] = useState(null);
  const [enrichedTotal, setEnrichedTotal] = useState(null);
  const [filters, setFilters] = useState(initialSearchState.filters);
  const [chips, setChips] = useState(initialSearchState.chips);
  const [savedRecipeIds, setSavedRecipeIds] = useState([]);
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const abortControllerRef = useRef(null);
  const loadMoreRef = useRef(null);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);
  const categoriesRef = useRef(null);
  const isSavedPage = currentPath === "/saved";

  useEffect(() => {
    const onPopState = () => setCurrentPath(getCurrentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigateTo(path) {
    if (getCurrentPath() === path) return;
    window.history.pushState({}, "", path);
    setCurrentPath(path);
  }

  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;
    let lastTotal = 0;

    async function loadStatus() {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch("/api/recipes/status", {
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Unable to load recipes");
        const payload = await response.json();
        if (!cancelled) {
          lastTotal = payload.total;
          setIndexedTotal(payload.total);
          setEnrichedTotal(payload.enriched);
          setSavedRecipeIds(
            Array.isArray(payload.savedRecipeIds) ? payload.savedRecipeIds : []
          );
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
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (!cancelled) {
          timeoutId = window.setTimeout(loadStatus, lastTotal > 0 ? 3000 : 500);
        }
      }
    }

    loadStatus();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const queryChips = isSavedPage ? [] : chips;
    const queryCategory = isSavedPage ? "All" : filters.category;
    if (!isSavedPage && queryChips.length === 0 && queryCategory === "All") return;
    let cancelled = false;
    const controller = new AbortController();

    async function loadResults() {
      try {
        const response = await fetch(
          buildRecipesUrl("/api/recipes", {
            chips: queryChips,
            category: queryCategory
          }),
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("Unable to load recipes");
        const payload = await response.json();
        if (!cancelled) {
          setData((current) => ({
            ...payload,
            total: current?.total ?? payload.total,
            enriched: current?.enriched ?? payload.enriched
          }));
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
  }, [chips, filters.category, isSavedPage]);

  useEffect(() => {
    if (!isSavedPage) return;
    if (searchRef.current) {
      searchRef.current.scrollIntoView({ block: "start" });
    }
  }, [isSavedPage]);

  const categories = useMemo(() => {
    const recipes = data?.recipes;
    if (!Array.isArray(recipes) || recipes.length === 0) return [];
    const values = new Set(recipes.flatMap((recipe) => recipe.categories ?? []));
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const visibleRecipes = data?.recipes ?? [];
  const filteredRecipes = useMemo(
    () => applyClientFilters(visibleRecipes, filters),
    [visibleRecipes, filters]
  );
  const savedRecipes = useMemo(
    () => visibleRecipes.filter((recipe) => savedRecipeIds.includes(recipe.id)),
    [visibleRecipes, savedRecipeIds]
  );
  const progressiveLoadingEnabled = filteredRecipes.length > batchSize;
  const renderedRecipes = progressiveLoadingEnabled
    ? filteredRecipes.slice(0, visibleCount)
    : filteredRecipes;

  useEffect(() => {
    setVisibleCount(getInitialVisibleCount(filteredRecipes.length, batchSize));
  }, [chips, filters, filteredRecipes.length]);

  useEffect(() => {
    saveSearchState({ chips, filters });
  }, [chips, filters]);

  useEffect(() => {
    if (!progressiveLoadingEnabled) return;
    if (visibleCount >= filteredRecipes.length) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (!loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((current) =>
            getNextVisibleCount(current, filteredRecipes.length, batchSize)
          );
        }
      },
      { rootMargin: "320px 0px" }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [progressiveLoadingEnabled, visibleCount, filteredRecipes.length]);

  function addChips(newTerms) {
    setChips((current) => [
      ...current,
      ...newTerms.filter((term) => !current.includes(term))
    ]);
  }

  function removeChip(chip) {
    setChips((current) => current.filter((c) => c !== chip));
  }

  function jumpToSection(sectionRef, { focusInput = false } = {}) {
    const scrollToSection = () => {
      sectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
      if (focusInput) {
        searchInputRef.current?.focus({ preventScroll: true });
      }
    };

    if (currentPath === "/saved") {
      navigateTo("/");
      window.requestAnimationFrame(scrollToSection);
      return;
    }

    scrollToSection();
  }

  async function toggleSavedRecipe(recipe) {
    const recipeId = recipe.id;
    const isSaved = savedRecipeIds.includes(recipeId);
    const previousSavedIds = savedRecipeIds;
    const nextSavedIds = isSaved
      ? savedRecipeIds.filter((id) => id !== recipeId)
      : [...savedRecipeIds, recipeId];
    setSavedRecipeIds(nextSavedIds);

    try {
      const requestInit = isSaved
        ? { method: "DELETE" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ recipeId })
          };
      const response = await fetch(
        isSaved ? `/api/saved-recipes/${recipeId}` : "/api/saved-recipes",
        requestInit
      );
      if (!response.ok) throw new Error("Unable to update saved recipes");
      const payload = await response.json();
      setSavedRecipeIds(
        Array.isArray(payload?.savedRecipeIds) ? payload.savedRecipeIds : nextSavedIds
      );
    } catch (toggleError) {
      setSavedRecipeIds(previousSavedIds);
      setError(toggleError.message);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/recipes/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          force: false,
          urls: visibleRecipes.map((recipe) => recipe.url)
        })
      });
      if (response.ok) {
        const payload = await response.json();
        setIndexedTotal(payload.total);
        setEnrichedTotal(payload.enriched);
        setData((current) => ({ ...payload, recipes: current?.recipes ?? [] }));
      }
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="app-shell">
      <div className="hero-decor hero-decor-top" aria-hidden="true" />
      <div className="hero-decor hero-decor-right" aria-hidden="true" />
      <header className="hero">
        <div className="hero-top-row">
          <div className="brand-mark" aria-label="Riverford Recipes">
            <span className="brand-mark-wordmark" aria-hidden="true">
              <strong>RIVERFORD</strong>
              <span>RECIPES</span>
            </span>
            <LeafMark />
          </div>
          {indexedTotal !== null ? (
            <p className="total-pill" aria-label="Total recipes indexed">
              <span aria-hidden="true" className="total-pill-icon">
                <BowlMark />
              </span>
              {indexedTotal.toLocaleString()} total
            </p>
          ) : null}
          <button
            type="button"
            className={`saved-page-link${isSavedPage ? " active" : ""}`}
            onClick={() => navigateTo("/saved")}
          >
            Saved
          </button>
        </div>
        <div className="hero-heading-row">
          {isSavedPage ? (
            <h1>Saved recipes</h1>
          ) : (
            <h1>
              <span className="hero-title-main">Find a meal</span>
              <span className="hero-title-sub"> from the recipe archive</span>
            </h1>
          )}
        </div>
        {isSavedPage ? (
          <p className="status">
            {savedRecipes.length === 1
              ? "1 saved recipe"
              : `${savedRecipes.length.toLocaleString()} saved recipes`}
          </p>
        ) : data ? (
          <RecipeStatus
            total={indexedTotal ?? data.total}
            enriched={enrichedTotal ?? data.enriched}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            matchedCount={filteredRecipes.length}
            hasQuery={chips.length > 0}
          />
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
          {isSavedPage ? (
            <section className="saved-page">
              {savedRecipes.length === 0 ? (
                <section className="welcome-state saved-empty">
                  <div className="welcome-mark" aria-hidden="true">
                    ♥
                  </div>
                  <div>
                    <h2>No saved recipes yet.</h2>
                    <p>
                      Save recipes from the main page and they’ll appear here.
                    </p>
                    <button
                      type="button"
                      className="saved-empty-cta"
                      onClick={() => navigateTo("/")}
                    >
                      Browse recipes
                    </button>
                  </div>
                </section>
              ) : (
                <section className="recipe-grid" aria-label="Saved recipes">
                  {savedRecipes.map((recipe) => (
                    <RecipeCard
                      key={recipe.id}
                      recipe={recipe}
                      isSaved={true}
                      onToggleSave={toggleSavedRecipe}
                    />
                  ))}
                </section>
              )}
            </section>
          ) : (
            <>
              <UnifiedSearch
                onAddChips={addChips}
                sectionRef={searchRef}
                inputRef={searchInputRef}
              />

              <QuickCategories
                activeCategory={filters.category}
                sectionRef={categoriesRef}
                onSelectCategory={(category) =>
                  setFilters((current) => ({ ...current, category }))
                }
              />

              {chips.length > 0 ? (
                <div className="search-chips" aria-label="Search terms">
                  {chips.map((chip) => (
                    <button
                      key={chip}
                      onClick={() => removeChip(chip)}
                      type="button"
                      aria-label={`Remove ${chip}`}
                    >
                      <span>{chip}</span>
                      <span aria-hidden="true" className="chip-remove-mark">
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {chips.length === 0 && filters.category === "All" ? (
                <section className="welcome-state">
                  <div className="welcome-mark" aria-hidden="true">
                    ✦
                  </div>
                  <div>
                    <h2>Search by recipe name or ingredient.</h2>
                    <p>
                      Add a search term, or choose a quick category to browse.
                    </p>
                    <StarterSearches onPickSearch={addChips} />
                    <div className="welcome-steps" aria-hidden="true">
                      <span>Type a term</span>
                      <span>Press Enter</span>
                      <span>See matches</span>
                    </div>
                  </div>
                </section>
              ) : (
                <>
                  <section className="filters" aria-label="Recipe filters">
                <label>
                  <span className="filter-label-title">
                    <TagMark />
                    Category
                  </span>
                  <select
                    value={filters.category}
                    onChange={(e) =>
                      setFilters((current) => ({
                        ...current,
                        category: e.target.value
                      }))
                    }
                  >
                    {["All", ...categories].map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="filter-label-title">
                    <PeopleMark />
                    Servings
                  </span>
                  <select
                    value={filters.servings}
                    onChange={(e) =>
                      setFilters((current) => ({
                        ...current,
                        servings: e.target.value
                      }))
                    }
                  >
                    <option value="All">All</option>
                    <option value="1-2">1–2</option>
                    <option value="3-4">3–4</option>
                    <option value="5+">5+</option>
                  </select>
                </label>
                <label>
                  <span className="filter-label-title">
                    <ClockMark />
                    Cook time
                  </span>
                  <select
                    value={filters.cookTime}
                    onChange={(e) =>
                      setFilters((current) => ({
                        ...current,
                        cookTime: e.target.value
                      }))
                    }
                  >
                    <option value="All">All</option>
                    <option value="<30">&lt; 30 min</option>
                    <option value="30-60">30–60 min</option>
                    <option value=">60">&gt; 60 min</option>
                  </select>
                </label>
                <label>
                  <span className="filter-label-title">
                    <SortMark />
                    Sort
                  </span>
                  <select
                    value={filters.sort}
                    onChange={(e) =>
                      setFilters((current) => ({ ...current, sort: e.target.value }))
                    }
                  >
                    <option value="relevance">Relevance</option>
                    <option value="title">Title A–Z</option>
                    <option value="time-asc">Cook time ↑</option>
                    <option value="time-desc">Cook time ↓</option>
                  </select>
                </label>
              </section>

                  <section className="recipe-grid" aria-label="Recipes">
                {filteredRecipes.length === 0 ? (
                  <p className="empty-state">No recipes match that search.</p>
                ) : null}
                {renderedRecipes.map((recipe) => (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    isSaved={savedRecipeIds.includes(recipe.id)}
                    onToggleSave={toggleSavedRecipe}
                  />
                ))}
                {progressiveLoadingEnabled &&
                renderedRecipes.length < filteredRecipes.length ? (
                  <div
                    className="recipe-grid-sentinel"
                    aria-hidden="true"
                    ref={loadMoreRef}
                  />
                ) : null}
                  </section>
                </>
              )}
            </>
          )}
        </>
      ) : null}
      {data ? (
        <BottomActions
          currentPath={currentPath}
          navigateTo={navigateTo}
          onSearchClick={() => jumpToSection(searchRef, { focusInput: true })}
          onCategoriesClick={() => jumpToSection(categoriesRef)}
        />
      ) : null}
    </main>
  );
}

function RecipeStatus({
  total,
  enriched,
  refreshing,
  onRefresh,
  matchedCount,
  hasQuery
}) {
  const complete = enriched >= total && total > 0;
  const busy = refreshing || (total > 0 && !complete);
  const matchLabel =
    matchedCount === 1 ? "1 matching recipe" : `${matchedCount.toLocaleString()} matching recipes`;
  return (
    <div className={`recipe-status${hasQuery ? " has-query" : " idle"}`}>
      <div className="status-row">
        <div className="status-main">
          <p className="status">{hasQuery ? matchLabel : "Search to see matching recipes"}</p>
          {busy && (
            <span className="spinner" role="status" aria-label="Loading" />
          )}
        </div>
        {total > 0 && (
          <button
            className="refresh-btn"
            onClick={onRefresh}
            disabled={refreshing}
            type="button"
            aria-label="Refresh"
          >
            ↻
          </button>
        )}
      </div>
      {!complete && total > 0 && (
        <>
          <progress
            className="enrichment-bar"
            value={enriched}
            max={total}
            aria-label={`${enriched} of ${total} recipes enriched`}
          />
          {!complete && (
            <p className="enrichment-label">
              {enriched.toLocaleString()} of {total.toLocaleString()} enriched
            </p>
          )}
        </>
      )}
    </div>
  );
}

function UnifiedSearch({ onAddChips, sectionRef, inputRef }) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const terms = normalizeIngredientQuery(draft);
    if (terms.length === 0) return;
    onAddChips(terms);
    setDraft("");
  }

  return (
    <label className="unified-search" ref={sectionRef}>
      <span className="unified-search-label">
        <SearchMark />
        Search recipes or ingredients
      </span>
      <span className="unified-search-controls">
        <input
          ref={inputRef}
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
      <span className="search-hint">
        Press Enter or Search to add each term as a keyword.
      </span>
    </label>
  );
}

const QUICK_CATEGORIES = [
  "Quick ideas",
  "Vegetarian",
  "Vegetarian mains",
  "Main",
  "Side",
  "Salads",
  "Soups & stews",
  "Pudding & Cake"
];

const STARTER_SEARCHES = ["pasta", "soup", "chicken", "salad"];

function QuickCategories({ activeCategory, onSelectCategory, sectionRef }) {
  const railRef = useRef(null);
  const [edgeState, setEdgeState] = useState({
    showStartFade: false,
    showEndFade: false
  });

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      setEdgeState(getQuickCategoryEdgeState(rail));
    };

    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    rail.scrollLeft = 0;
    update();
    rail.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      rail.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  return (
    <section className="quick-categories" aria-label="Quick categories" ref={sectionRef}>
      <div className="quick-categories-head">
        <p>
          <span className="quick-categories-title-mark" aria-hidden="true">
            <SparkMark />
          </span>
          Quick categories
        </p>
        <span className="quick-categories-hint">Swipe to see more →</span>
      </div>
      <div
        className={`quick-category-scroll-shell${edgeState.showStartFade ? " has-start-fade" : ""}${edgeState.showEndFade ? " has-end-fade" : ""}`}
      >
        <div
          className="quick-category-chips"
          ref={railRef}
          role="group"
          aria-label="Quick category chips"
        >
          {QUICK_CATEGORIES.map((category) => {
            const active = activeCategory === category;
            return (
              <button
                key={category}
                type="button"
                className={active ? "active" : ""}
                onClick={() => onSelectCategory(category)}
                aria-pressed={active}
              >
                {category}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BottomActions({
  onSearchClick,
  onCategoriesClick,
  currentPath,
  navigateTo
}) {
  const savedActive = currentPath === "/saved";
  return (
    <nav className="mobile-action-bar" aria-label="Quick actions">
      <button
        type="button"
        className="primary"
        onClick={onSearchClick}
        aria-label="Jump to search"
      >
        <span className="mobile-action-bar-label">
          <span className="mobile-action-bar-glyph" aria-hidden="true">
            ⌕
          </span>
          <span>Search</span>
        </span>
      </button>
      <button
        type="button"
        className="secondary"
        onClick={onCategoriesClick}
        aria-label="Jump to categories"
      >
        <span className="mobile-action-bar-label">
          <span className="mobile-action-bar-glyph" aria-hidden="true">
            ✦
          </span>
          <span>Categories</span>
        </span>
      </button>
      <button
        type="button"
        className={`saved${savedActive ? " active" : ""}`}
        onClick={() => navigateTo("/saved")}
        aria-label="Saved items"
        aria-pressed={savedActive ? "true" : "false"}
      >
        <span className="mobile-action-bar-label">
          <span className="mobile-action-bar-glyph" aria-hidden="true">
            ♡
          </span>
          <span>Saved</span>
        </span>
      </button>
    </nav>
  );
}

function RecipeCard({ recipe, isSaved, onToggleSave }) {
  return (
    <article
      className={`recipe-card${recipe.image ? " has-image" : ""}`}
      style={recipe.image ? { "--card-image": `url(${recipe.image})` } : undefined}
    >
      <a
        className="recipe-card-media-link"
        href={recipe.url}
        rel="noreferrer"
        target="_blank"
        aria-label={`${recipe.title} recipe image`}
      >
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
      <div className="recipe-card-body">
        <div className="recipe-card-topline">
          {recipe.cookTime || recipe.servings ? (
            <div className="recipe-meta">
              {recipe.cookTime ? (
                <span className="meta-pill">
                  <span aria-hidden="true" className="meta-icon">
                    <ClockMark />
                  </span>
                  {formatCookTime(recipe.cookTime)}
                </span>
              ) : null}
              {recipe.servings ? (
                <span className="meta-pill">
                  <span aria-hidden="true" className="meta-icon">
                    <PeopleMark />
                  </span>
                  Serves {recipe.servings}
                </span>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className={`bookmark-btn${isSaved ? " active" : ""}`}
            aria-label={`${isSaved ? "Remove saved recipe" : "Save"} ${recipe.title}`}
            aria-pressed={isSaved ? "true" : "false"}
            onClick={() => onToggleSave(recipe)}
          >
            <BookmarkMark />
          </button>
        </div>
        <h2>
          <a href={recipe.url} rel="noreferrer" target="_blank">
            {recipe.title}
          </a>
        </h2>
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
          <div className="match-stack">
            <p className="matches">
              You have {recipe.matchCount} of {recipe.normalizedIngredients.length} ingredients
            </p>
            <p className="matches matched">
              Matched: {summarizeIngredients(recipe.matchedIngredients)}
            </p>
            {recipe.missingIngredients.length > 0 ? (
              <p className="matches missing">
                Other ingredients: {summarizeIngredients(recipe.missingIngredients)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function getCurrentPath() {
  if (typeof window === "undefined") return "/";
  return window.location.pathname === "/saved" ? "/saved" : "/";
}

function LeafMark() {
  return (
    <svg viewBox="0 0 48 32" aria-hidden="true" focusable="false">
      <path d="M22 27c8.4.4 15.3-4.8 18.2-12.2-6.5.1-11.6 1.7-15.5 4.8-2.4 1.9-3.9 4-4.5 7.4" />
      <path d="M18 28c-4.3-2-8.4-6.8-8.4-12.8 0-4.2 2.5-8.3 7.1-11.5 3.8 6.8 4.7 13.1 2.8 24.3" />
      <path d="M20.8 22.4c2.1-2 4.9-3.8 8.6-5.1" />
    </svg>
  );
}

function BowlMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 12c0 3 3.2 7 8 7s8-4 8-7" />
      <path d="M5 12h14" />
      <path d="M7 8c1.2 1 1.7 2.1 1.7 3.2" />
      <path d="M12 7c1.2 1 1.7 2.1 1.7 3.2" />
      <path d="M17 8c1.2 1 1.7 2.1 1.7 3.2" />
    </svg>
  );
}

function SearchMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M15 15l4 4" />
    </svg>
  );
}

function SparkMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3l1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3z" />
    </svg>
  );
}

function TagMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 10.5 10.5 4.5H19.5v9L13.5 19.5l-9-9Z" />
      <circle cx="15.2" cy="8.2" r="1.1" />
    </svg>
  );
}

function PeopleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="16.5" cy="9.2" r="1.9" />
      <path d="M4.5 18c.7-2.6 2.7-4 4.8-4s4.1 1.4 4.8 4" />
      <path d="M13.3 17.5c.5-1.7 1.8-2.7 3.4-2.7 1.6 0 2.9 1 3.4 2.7" />
    </svg>
  );
}

function ClockMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="7.6" />
      <path d="M12 8.5v4.2l2.9 1.7" />
    </svg>
  );
}

function SortMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6h8" />
      <path d="M6 12h12" />
      <path d="M6 18h4" />
      <path d="M17 5v14" />
      <path d="M14.5 7.5 17 5l2.5 2.5" />
    </svg>
  );
}

function BookmarkMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.5L6 20V5.5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function CompassMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="7.5" />
      <path d="m9 15 2-5 4-2-2 5-4 2Z" />
    </svg>
  );
}

function HeartMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 19.5S4.8 15.1 4.8 9.6A3.8 3.8 0 0 1 8.6 5.8c1.5 0 2.8.8 3.4 2 .6-1.2 1.9-2 3.4-2a3.8 3.8 0 0 1 3.8 3.8c0 5.5-7.2 9.9-7.2 9.9Z" />
    </svg>
  );
}

function StarterSearches({ onPickSearch }) {
  return (
    <section className="starter-searches" aria-label="Starter searches">
      <p>Try one of these searches</p>
      <div className="starter-search-chips" role="group" aria-label="Starter search chips">
        {STARTER_SEARCHES.map((term) => (
          <button key={term} type="button" onClick={() => onPickSearch([term])}>
            Try {term}
          </button>
        ))}
      </div>
    </section>
  );
}

function formatCookTime(duration) {
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!match) return duration;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  if (hours && minutes) return `${hours} hr ${minutes} min`;
  if (hours) return `${hours} hr`;
  return `${minutes} min`;
}

export function getQuickCategoryEdgeState(
  railOrMetrics,
  maybeClientWidth,
  maybeScrollWidth
) {
  const metrics =
    typeof railOrMetrics === "object" &&
    railOrMetrics !== null &&
    "scrollLeft" in railOrMetrics
      ? railOrMetrics
      : {
          scrollLeft: railOrMetrics,
          clientWidth: maybeClientWidth,
          scrollWidth: maybeScrollWidth
        };

  const scrollLeft = Number(metrics.scrollLeft ?? 0);
  const clientWidth = Number(metrics.clientWidth ?? 0);
  const scrollWidth = Number(metrics.scrollWidth ?? 0);
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
  const canScroll = scrollWidth > clientWidth + 1;
  const atStart = scrollLeft <= 1;
  const atEnd = scrollLeft >= maxScrollLeft - 1;

  return {
    showStartFade: canScroll && !atStart,
    showEndFade: canScroll && !atEnd
  };
}

function buildRecipesUrl(endpoint, { chips, category }) {
  const params = new URLSearchParams();
  if (chips.length > 0) params.set("q", chips.join(","));
  const query = params.toString();
  return query ? `${endpoint}?${query}` : endpoint;
}

export function summarizeIngredients(ingredients, maxVisible = 2) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return "";
  if (ingredients.length <= maxVisible) return ingredients.join(", ");
  const visible = ingredients.slice(0, maxVisible).join(", ");
  const remainder = ingredients.length - maxVisible;
  return `${visible} +${remainder} more`;
}

export function getInitialVisibleCount(total, limit = 20) {
  return total > limit ? limit : total;
}

export function getNextVisibleCount(current, total, step = 20) {
  return Math.min(total, current + step);
}

export function loadSearchState() {
  if (typeof window === "undefined") {
    return { chips: [], filters: defaultFilters() };
  }

  try {
    const rawValue = window.localStorage.getItem(SEARCH_STATE_STORAGE_KEY);
    if (!rawValue) return { chips: [], filters: defaultFilters() };

    const parsed = JSON.parse(rawValue);
    return {
      chips: Array.isArray(parsed?.chips)
        ? parsed.chips.filter((chip) => typeof chip === "string")
        : [],
      filters: {
        category:
          typeof parsed?.filters?.category === "string"
            ? parsed.filters.category
            : typeof parsed?.selectedCategory === "string"
              ? parsed.selectedCategory
              : "All",
        servings:
          typeof parsed?.filters?.servings === "string"
            ? parsed.filters.servings
            : "All",
        cookTime:
          typeof parsed?.filters?.cookTime === "string"
            ? parsed.filters.cookTime
            : "All",
        sort:
          typeof parsed?.filters?.sort === "string"
            ? parsed.filters.sort
            : "relevance"
      }
    };
  } catch {
    return { chips: [], filters: defaultFilters() };
  }
}

export function saveSearchState({ chips, filters }) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      SEARCH_STATE_STORAGE_KEY,
      JSON.stringify({
        chips: Array.isArray(chips) ? chips : [],
        filters: {
          category:
            typeof filters?.category === "string" ? filters.category : "All",
          servings:
            typeof filters?.servings === "string" ? filters.servings : "All",
          cookTime:
            typeof filters?.cookTime === "string" ? filters.cookTime : "All",
          sort: typeof filters?.sort === "string" ? filters.sort : "relevance"
        }
      })
    );
  } catch {
    // Ignore localStorage failures (private mode / quota / disabled storage).
  }
}

function defaultFilters() {
  return {
    category: "All",
    servings: "All",
    cookTime: "All",
    sort: "relevance"
  };
}

function applyClientFilters(recipes, filters) {
  let filtered = recipes.filter((recipe) =>
    filters.category === "All"
      ? true
      : (recipe.categories ?? []).includes(filters.category)
  );

  filtered = filtered.filter((recipe) => {
    if (filters.servings === "All") return true;
    const servings = Number(recipe.servings);
    if (!Number.isFinite(servings)) return false;
    if (filters.servings === "1-2") return servings <= 2;
    if (filters.servings === "3-4") return servings >= 3 && servings <= 4;
    if (filters.servings === "5+") return servings >= 5;
    return true;
  });

  filtered = filtered.filter((recipe) => {
    if (filters.cookTime === "All") return true;
    const minutes = parseCookTimeMinutes(recipe.cookTime);
    if (minutes === null) return false;
    if (filters.cookTime === "<30") return minutes < 30;
    if (filters.cookTime === "30-60") return minutes >= 30 && minutes <= 60;
    if (filters.cookTime === ">60") return minutes > 60;
    return true;
  });

  if (filters.sort === "title") {
    return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
  }
  if (filters.sort === "time-asc") {
    return [...filtered].sort(
      (a, b) =>
        (parseCookTimeMinutes(a.cookTime) ?? Number.POSITIVE_INFINITY) -
        (parseCookTimeMinutes(b.cookTime) ?? Number.POSITIVE_INFINITY)
    );
  }
  if (filters.sort === "time-desc") {
    return [...filtered].sort(
      (a, b) =>
        (parseCookTimeMinutes(b.cookTime) ?? Number.NEGATIVE_INFINITY) -
        (parseCookTimeMinutes(a.cookTime) ?? Number.NEGATIVE_INFINITY)
    );
  }
  return filtered;
}

function parseCookTimeMinutes(duration) {
  if (!duration || typeof duration !== "string") return null;
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  return hours * 60 + minutes;
}
