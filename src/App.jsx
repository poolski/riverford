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
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState(initialSearchState.filters);
  const [chips, setChips] = useState(initialSearchState.chips);
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const abortControllerRef = useRef(null);
  const loadMoreRef = useRef(null);

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
    if (chips.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();

    async function loadResults() {
      try {
        const response = await fetch(
          buildRecipesUrl("/api/recipes", { chips }),
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
  }, [chips]);

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
    setChips((current) => {
      const next = current.filter((c) => c !== chip);
      if (next.length === 0) {
        setData((d) => (d ? { ...d, recipes: [] } : d));
        setFilters((current) => ({ ...current, category: "All" }));
      }
      return next;
    });
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
        setData((current) => ({ ...payload, recipes: current?.recipes ?? [] }));
      }
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-heading-row">
        <h1>Find a meal from the recipe archive</h1>
        {data ? (
          <p className="total-pill" aria-label="Total recipes indexed">
            {data.total.toLocaleString()} total
          </p>
        ) : null}
        </div>
        {data ? (
          <RecipeStatus
            total={data.total}
            enriched={data.enriched}
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
                  <span>{chip}</span>
                  <span aria-hidden="true" className="chip-remove-mark">
                    ×
                  </span>
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
              <section className="filters" aria-label="Recipe filters">
                <label>
                  Category
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
                  Servings
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
                  Cook time
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
                  Sort
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
                  <article
                    className={`recipe-card${recipe.image ? " has-image" : ""}`}
                    key={recipe.id}
                    style={
                      recipe.image
                        ? { "--card-image": `url(${recipe.image})` }
                        : undefined
                    }
                  >
                    <div className="recipe-card-body">
                    <h2>
                      <a href={recipe.url} rel="noreferrer" target="_blank">
                        {recipe.title}
                      </a>
                    </h2>
                    {recipe.cookTime || recipe.servings ? (
                      <div className="recipe-meta">
                        {recipe.cookTime ? (
                          <span className="meta-pill">
                            <span aria-hidden="true" className="meta-icon">
                              <svg viewBox="0 0 24 24" focusable="false">
                                <circle cx="12" cy="12" r="8.5" />
                                <path d="M12 7v5l3 2" />
                              </svg>
                            </span>
                            {formatCookTime(recipe.cookTime)}
                          </span>
                        ) : null}
                        {recipe.servings ? (
                          <span className="meta-pill">
                            <span aria-hidden="true" className="meta-icon">
                              <svg viewBox="0 0 24 24" focusable="false">
                                <circle cx="9" cy="9" r="2.5" />
                                <circle cx="16" cy="10" r="2" />
                                <path d="M4.5 17c.6-2.4 2.4-3.5 4.5-3.5s3.9 1.1 4.5 3.5" />
                                <path d="M13.2 16.8c.4-1.7 1.8-2.6 3.4-2.6 1.6 0 2.8.8 3.4 2.6" />
                              </svg>
                            </span>
                            Serves {recipe.servings}
                          </span>
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
                          Matched: {summarizeIngredients(recipe.matchedIngredients)}
                        </p>
                        {recipe.missingIngredients.length > 0 ? (
                          <p className="matches missing">
                            Other ingredients: {summarizeIngredients(recipe.missingIngredients)}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    </div>
                  </article>
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
    <div className="recipe-status">
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
      <span className="search-hint">
        Press Enter or Search to add each term as a keyword.
      </span>
    </label>
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
