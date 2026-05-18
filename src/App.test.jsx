import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  App,
  getInitialVisibleCount,
  getNextVisibleCount,
  getQuickCategoryEdgeState,
  loadSearchState,
  saveSearchState,
  summarizeIngredients
} from "./App.jsx";
import {
  normalizeIngredient,
  normalizeRecipeIngredients
} from "../server/ingredients.js";

function mockFetch(payload) {
  let savedRecipeIds = [...(payload.savedRecipeIds ?? [])];
  global.fetch = vi.fn().mockImplementation(async (url, options = {}) => {
    if (url.startsWith("/api/saved-recipes")) {
      if (options.method === "POST") {
        const body = JSON.parse(options.body ?? "{}");
        if (!savedRecipeIds.includes(body.recipeId)) {
          savedRecipeIds = [...savedRecipeIds, body.recipeId];
        }
      } else if (options.method === "DELETE") {
        const recipeId = Number(url.split("/").pop());
        savedRecipeIds = savedRecipeIds.filter((id) => id !== recipeId);
      }

      return {
        ok: true,
        json: async () => ({ savedRecipeIds })
      };
    }

    return {
      ok: true,
      json: async () =>
        url.startsWith("/api/recipes/status")
          ? {
              usedCache: payload.usedCache,
              total: payload.total,
              enriched: payload.enriched
            }
          : url.startsWith("/api/recipes/refresh")
            ? {
                usedCache: payload.usedCache,
                total: payload.total,
                enriched: payload.enriched
              }
            : filterPayload(payload, url)
    };
  });
}

function filterPayload(payload, url) {
  const params = new URL(url, "http://localhost").searchParams;
  const category = params.get("category");
  const terms = (params.get("q") ?? "")
    .split(",")
    .filter(Boolean)
    .map((t) => t.trim().toLowerCase())
    .map(normalizeIngredient)
    .map(normalizeMatchTerm);

  const recipes = payload.recipes
    .map((recipe) => {
      const normalizedIngredients = normalizeRecipeIngredients(
        recipe.ingredients ?? []
      );
      const matchedIngredients = terms.filter((term) =>
        normalizedIngredients.some(
          (ri) => ingredientMatchesTerm(ri, term)
        )
      );
      return {
        ...recipe,
        normalizedIngredients,
        matchedIngredients,
        missingIngredients: normalizedIngredients.filter(
          (ri) =>
            !terms.some((term) => ingredientMatchesTerm(ri, term))
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
                (ri) => ingredientMatchesTerm(ri, term)
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

async function searchFor(term) {
  const input = await screen.findByRole("textbox", { name: /search/i });
  await userEvent.type(input, `${term}{enter}`);
}

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("summarizes long ingredient lists with a compact tail count", () => {
    expect(summarizeIngredients(["carrot", "onion", "celery", "thyme"])).toBe(
      "carrot, onion +2 more"
    );
  });

  it("keeps short ingredient lists unchanged", () => {
    expect(summarizeIngredients(["carrot"])).toBe("carrot");
    expect(summarizeIngredients(["carrot", "onion"])).toBe("carrot, onion");
  });

  it("shows all cards immediately when there are 20 or fewer", () => {
    expect(getInitialVisibleCount(0)).toBe(0);
    expect(getInitialVisibleCount(5)).toBe(5);
    expect(getInitialVisibleCount(20)).toBe(20);
  });

  it("shows only the first 20 cards initially when there are more than 20", () => {
    expect(getInitialVisibleCount(21)).toBe(20);
    expect(getInitialVisibleCount(100)).toBe(20);
  });

  it("increases visible cards by 20 without exceeding total", () => {
    expect(getNextVisibleCount(20, 100)).toBe(40);
    expect(getNextVisibleCount(40, 100)).toBe(60);
    expect(getNextVisibleCount(90, 100)).toBe(100);
    expect(getNextVisibleCount(100, 100)).toBe(100);
  });

  it("persists and restores search state from local storage", () => {
    window.localStorage.clear();
    saveSearchState({
      chips: ["chicken", "leek"],
      filters: {
        category: "Soup",
        servings: "3-4",
        cookTime: "<30",
        sort: "title"
      }
    });

    expect(loadSearchState()).toEqual({
      chips: ["chicken", "leek"],
      filters: {
        category: "Soup",
        servings: "3-4",
        cookTime: "<30",
        sort: "title"
      }
    });
  });

  it("falls back safely when persisted search state is malformed", () => {
    window.localStorage.setItem("riverford.searchState.test.v1", "{oops");

    expect(loadSearchState()).toEqual({
      chips: [],
      filters: {
        category: "All",
        servings: "All",
        cookTime: "All",
        sort: "relevance"
      }
    });
  });

  it("loads only status initially and does not render recipes before a search", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        usedCache: false,
        total: 2,
        enriched: 2
      })
    });

    render(<App />);

    expect(await screen.findByText(/2 total/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/recipes/status",
      expect.any(Object)
    );
    expect(screen.queryByRole("region", { name: /recipes/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/search by recipe name or ingredient/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /quick categories/i })
    ).toBeInTheDocument();
  });

  it("shows recipes when a quick category is selected without ingredient chips", async () => {
    mockFetch({
      usedCache: false,
      total: 2,
      enriched: 2,
      recipes: [
        {
          id: "r1",
          title: "Fast Salad",
          url: "https://example.com/1",
          categories: ["Quick ideas"],
          ingredients: ["tomato"],
          cookTime: "PT10M",
          servings: "2"
        },
        {
          id: "r2",
          title: "Slow Roast",
          url: "https://example.com/2",
          categories: ["Main"],
          ingredients: ["potato"],
          cookTime: "PT2H",
          servings: "4"
        }
      ]
    });

    render(<App />);
    await screen.findByText(/2 total/i);

    await userEvent.click(
      screen.getByRole("button", { name: "Quick ideas" })
    );

    expect(await screen.findByText("Fast Salad")).toBeInTheDocument();
    expect(screen.queryByText("Slow Roast")).not.toBeInTheDocument();
  });

  it("keeps total indexed pill bound to status total after search results load", async () => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.startsWith("/api/recipes/status")) {
        return {
          ok: true,
          json: async () => ({ usedCache: false, total: 3012, enriched: 3012 })
        };
      }
      if (url.startsWith("/api/recipes?q=")) {
        return {
          ok: true,
          json: async () => ({
            usedCache: false,
            total: 3,
            enriched: 3,
            recipes: [
              {
                id: "r1",
                title: "Pasta One",
                url: "https://example.com/1",
                categories: ["Main"],
                ingredients: ["pasta"],
                matchCount: 1,
                matchedIngredients: ["pasta"],
                missingIngredients: [],
                normalizedIngredients: ["pasta"]
              }
            ]
          })
        };
      }
      return { ok: true, json: async () => ({ usedCache: false, total: 3012, enriched: 3012 }) };
    });

    render(<App />);
    await screen.findByText(/3,012 total/i);

    await searchFor("pasta");
    await screen.findByText("Pasta One");

    expect(screen.getByText(/3,012 total/i)).toBeInTheDocument();
    expect(screen.getByText(/1 matching recipe/i)).toBeInTheDocument();
  });

  it("keeps selected quick category when removing the last search chip", async () => {
    mockFetch({
      usedCache: false,
      total: 2,
      enriched: 2,
      recipes: [
        {
          id: "r1",
          title: "Soup One",
          url: "https://example.com/1",
          categories: ["Soups & stews"],
          ingredients: ["pasta"],
          cookTime: "PT30M",
          servings: "2"
        },
        {
          id: "r2",
          title: "Main One",
          url: "https://example.com/2",
          categories: ["Main"],
          ingredients: ["pasta"],
          cookTime: "PT30M",
          servings: "2"
        }
      ]
    });

    render(<App />);
    await screen.findByText(/2 total/i);

    await userEvent.click(screen.getByRole("button", { name: "Soups & stews" }));
    await searchFor("pasta");
    await screen.findByText("Soup One");

    await userEvent.click(screen.getByRole("button", { name: /remove pasta/i }));

    expect(screen.getByRole("button", { name: "Soups & stews" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(await screen.findByText("Soup One")).toBeInTheDocument();
    expect(screen.queryByText("Main One")).not.toBeInTheDocument();
  });

  it("shows enrichment progress bar while enrichment is in progress", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ usedCache: false, total: 100, enriched: 30 })
    });

    render(<App />);

    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("value", "30");
    expect(bar).toHaveAttribute("max", "100");
  });

  it("shows enriched count text while enrichment is in progress", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ usedCache: false, total: 100, enriched: 30 })
    });

    render(<App />);

    expect(await screen.findByText(/30 of 100 enriched/i)).toBeInTheDocument();
  });

  it("shows a spinner while enrichment is in progress", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ usedCache: false, total: 100, enriched: 30 })
    });

    render(<App />);

    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("hides the spinner once enrichment is complete", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ usedCache: false, total: 2, enriched: 2 })
    });

    render(<App />);

    await screen.findByText(/2 total/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a refresh button and triggers an immediate status poll when clicked", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ usedCache: false, total: 10, enriched: 5 })
    });

    render(<App />);
    await screen.findByRole("progressbar");

    const callsBefore = global.fetch.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(global.fetch.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("hides the enriched count text once enrichment is complete", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ usedCache: false, total: 2, enriched: 2 })
    });

    render(<App />);

    await screen.findByText(/2 total/i);
    expect(screen.queryByText(/enriched/i)).not.toBeInTheDocument();
  });

  it("hides the progress bar once enrichment is complete", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ usedCache: false, total: 2, enriched: 2 })
    });

    render(<App />);

    await screen.findByText(/2 total/i);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("re-polls within 1 second when total is 0, instead of waiting 3 seconds", async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        usedCache: false,
        total: calls++ === 0 ? 0 : 2,
        enriched: 0
      })
    }));

    render(<App />);
    await screen.findByText(/0 total/i);

    // With a 500ms fast-poll interval the second call should arrive well within 1s
    await screen.findByText(/2 total/i, { timeout: 1000 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("shows a loading state before recipes arrive", () => {
    global.fetch = vi.fn(
      () =>
        new Promise(() => {
          // deliberately unresolved
        })
    );

    render(<App />);

    expect(screen.getByText(/loading recipes/i)).toBeInTheDocument();
  });

  it("shows starter search suggestions that begin a search", async () => {
    mockFetch({
      usedCache: false,
      total: 1,
      enriched: 1,
      recipes: [
        {
          id: "r1",
          title: "Simple Pasta",
          url: "https://example.com/1",
          categories: ["Main"],
          ingredients: ["pasta"],
          enrichmentStatus: "enriched"
        }
      ]
    });

    render(<App />);
    await screen.findByText(/1 total/i);

    await userEvent.click(screen.getByRole("button", { name: /try pasta/i }));

    expect(await screen.findByRole("button", { name: /remove pasta/i })).toBeInTheDocument();
    expect(await screen.findByText("Simple Pasta")).toBeInTheDocument();
  });

  it("saves and unsaves recipes through the bookmark button", async () => {
    mockFetch({
      usedCache: false,
      total: 1,
      enriched: 1,
      recipes: [
        {
          id: 7,
          title: "Simple Pasta",
          url: "https://example.com/1",
          categories: ["Quick ideas"],
          ingredients: ["pasta"],
          cookTime: "PT10M",
          servings: "2",
          enrichmentStatus: "enriched"
        }
      ]
    });

    render(<App />);
    await screen.findByText(/1 total/i);
    await userEvent.click(screen.getByRole("button", { name: "Quick ideas" }));
    const saveButton = await screen.findByRole("button", {
      name: /save simple pasta/i
    });

    await userEvent.click(saveButton);
    expect(
      await screen.findByRole("button", { name: /remove saved recipe simple pasta/i })
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /remove saved recipe simple pasta/i })
    );
    expect(
      await screen.findByRole("button", { name: /save simple pasta/i })
    ).toBeInTheDocument();
  });

  it("uses the bottom quick actions to jump to the main search and categories", async () => {
    mockFetch({
      usedCache: false,
      total: 1,
      enriched: 1,
      recipes: [
        {
          id: "r1",
          title: "Simple Pasta",
          url: "https://example.com/1",
          categories: ["Main"],
          ingredients: ["pasta"],
          enrichmentStatus: "enriched"
        }
      ]
    });

    render(<App />);
    await screen.findByText(/1 total/i);

    await userEvent.click(screen.getByRole("button", { name: "Quick ideas" }));
    expect(await screen.findByRole("button", { name: /jump to search/i })).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /jump to search/i })
    );
    expect(screen.getByRole("textbox", { name: /search recipes or ingredients/i })).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: /jump to categories/i })
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("hides the trailing quick-category edge when scrolled to the end", () => {
    expect(
      getQuickCategoryEdgeState({
        scrollLeft: 220,
        clientWidth: 320,
        scrollWidth: 540
      })
    ).toEqual({
      showStartFade: true,
      showEndFade: false
    });
  });

  it("hides the leading quick-category edge when at the beginning", () => {
    expect(
      getQuickCategoryEdgeState({
        scrollLeft: 0,
        clientWidth: 320,
        scrollWidth: 540
      })
    ).toEqual({
      showStartFade: false,
      showEndFade: true
    });
  });

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
          ingredients: ["garlic", "olive oil", "pasta"],
          enrichmentStatus: "enriched"
        },
        {
          id: 2,
          title: "Poached Chicken",
          url: "https://www.riverford.co.uk/recipes/poached-chicken",
          categories: ["Chicken"],
          ingredients: ["garlic", "chicken breast"],
          enrichmentStatus: "enriched"
        }
      ]
    });

    render(<App />);
    await searchFor("garlic");
    await screen.findByText("Aglio Olio");
    await screen.findByText("Poached Chicken");

    await userEvent.selectOptions(screen.getByLabelText("Category"), "Chicken");

    await waitFor(() => {
      expect(screen.queryByText("Aglio Olio")).not.toBeInTheDocument();
    });
  });

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
    await screen.findByText(/2 total/i);

    const input = screen.getByRole("textbox", { name: /search/i });
    await userEvent.type(input, "chicken");

    expect(screen.queryByText("Aglio Olio")).not.toBeInTheDocument();

    await userEvent.type(input, "{enter}");

    expect(await screen.findByText("Poached Chicken")).toBeInTheDocument();
  });

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

    const recipeCard = screen
      .getByRole("link", { name: "Quick Supper" })
      .closest("article");
    expect(recipeCard).not.toBeNull();
    expect(recipeCard.querySelectorAll(".tag-row span")).toHaveLength(1);
  });

  it("does not start a second poll while the first is still in flight", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn(
      () =>
        new Promise(() => {
          // deliberately unresolved — finally never runs, no next poll scheduled
        })
    );

    render(<App />);

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9000);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("aborts an in-flight request when the component unmounts", () => {
    const abortSpy = vi.fn();
    vi.stubGlobal(
      "AbortController",
      class {
        signal = {};
        abort = abortSpy;
      }
    );
    global.fetch = vi.fn(
      () =>
        new Promise(() => {
          // deliberately unresolved
        })
    );

    const { unmount } = render(<App />);
    unmount();

    expect(abortSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

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

    await userEvent.selectOptions(screen.getByLabelText("Category"), "Soup");

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

    expect(
      await screen.findByText(/no recipes match that search/i)
    ).toBeInTheDocument();
  });

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
    await screen.findByText(/total/i);

    const input = screen.getByRole("textbox", { name: /search/i });
    await userEvent.type(input, "carrot{enter}");

    expect(
      screen.getByRole("button", { name: /remove carrot/i })
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /remove carrot/i }));

    expect(
      screen.getByText(/search by recipe name or ingredient/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /recipes/i })).not.toBeInTheDocument();
  });

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
    await screen.findByText(/total/i);

    await userEvent.type(
      screen.getByRole("textbox", { name: /search/i }),
      "carrot"
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));

    expect(
      screen.getByRole("button", { name: /remove carrot/i })
    ).toBeInTheDocument();
  });

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
    await screen.findByText(/total/i);

    const input = screen.getByRole("textbox", { name: /search/i });
    await userEvent.type(input, "tomatoes, soup{enter}");

    expect(
      screen.getByRole("button", { name: /remove tomatoes/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove soup/i })
    ).toBeInTheDocument();
  });

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

    expect(
      await screen.findByText(/you have 2 of 3 ingredients/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/other ingredients: stock/i)).toBeInTheDocument();
  });

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
});
