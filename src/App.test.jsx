import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.jsx";
import {
  normalizeIngredient,
  normalizeRecipeIngredients
} from "../server/ingredients.js";

function mockFetch(payload) {
  global.fetch = vi.fn().mockImplementation(async (url) => ({
    ok: true,
    json: async () =>
      url.startsWith("/api/recipes/status")
        ? {
            usedCache: payload.usedCache,
            total: payload.total,
            enriched: payload.enriched
          }
        : filterPayload(payload, url)
  }));
}

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

describe("App", () => {
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

    expect(await screen.findByText(/2 recipes ready/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/recipes/status",
      expect.any(Object)
    );
    expect(screen.queryByRole("region", { name: /recipes/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/search by recipe name or ingredient/i)
    ).toBeInTheDocument();
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

    await screen.findByText(/2 recipes ready/i);
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

    await screen.findByText(/2 recipes ready/i);
    expect(screen.queryByText(/enriched/i)).not.toBeInTheDocument();
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
    await screen.findByText(/0 recipes/i);

    // With a 500ms fast-poll interval the second call should arrive well within 1s
    await screen.findByText(/2 recipes/i, { timeout: 1000 });
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

    await userEvent.click(screen.getByRole("button", { name: "Chicken" }));

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
    await screen.findByText(/2 recipes ready/i);

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

    expect(screen.getAllByText("Quick ideas")).toHaveLength(2);
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
    await screen.findByText(/recipes ready/i);

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
    await screen.findByText(/recipes ready/i);

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
    await screen.findByText(/recipes ready/i);

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
    expect(screen.getByText(/missing: stock/i)).toBeInTheDocument();
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
