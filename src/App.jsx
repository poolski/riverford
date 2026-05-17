import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { normalizeIngredientQuery } from "./matching.js";

export function App() {
  const [data, setData] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [chips, setChips] = useState([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const abortControllerRef = useRef(null);

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

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/recipes/status");
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
        <h1>Find a meal from the recipe archive</h1>
        {data ? (
          <RecipeStatus
            total={data.total}
            enriched={data.enriched}
            refreshing={refreshing}
            onRefresh={handleRefresh}
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
                    {recipe.image ? (
                      <a
                        className="recipe-image-link"
                        href={recipe.url}
                        rel="noreferrer"
                        target="_blank"
                        tabIndex={-1}
                        aria-hidden="true"
                      >
                        <img
                          alt=""
                          className="recipe-image"
                          loading="lazy"
                          src={recipe.image}
                        />
                      </a>
                    ) : null}
                    <div className="recipe-card-body">
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
                    </div>
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

function RecipeStatus({ total, enriched, refreshing, onRefresh }) {
  const complete = enriched >= total && total > 0;
  const busy = refreshing || (total > 0 && !complete);
  return (
    <div className="recipe-status">
      <div className="status-row">
        <p className="status">
          {complete
            ? `${total.toLocaleString()} recipes ready`
            : `${total.toLocaleString()} recipes`}
        </p>
        {busy && (
          <span className="spinner" role="status" aria-label="Loading" />
        )}
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
      {total > 0 && (
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
  if (category !== "All") params.set("category", category);
  const query = params.toString();
  return query ? `${endpoint}?${query}` : endpoint;
}
