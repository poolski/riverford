import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { normalizeRecipeIngredients } from "./ingredients.js";

export function createRecipeStore(dbPath) {
  const CURRENT_METADATA_VERSION = 5;
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      categories TEXT NOT NULL DEFAULT '[]',
      ingredients TEXT NOT NULL DEFAULT '[]',
      normalized_ingredients TEXT NOT NULL DEFAULT '[]',
      cook_time TEXT,
      servings TEXT,
      metadata_version INTEGER NOT NULL DEFAULT 0,
      enrichment_status TEXT NOT NULL DEFAULT 'pending',
      refresh_requested_at TEXT,
      fetched_at TEXT,
      enriched_at TEXT
    );
  `);
  ensureColumn(db, "recipes", "cook_time", "TEXT");
  ensureColumn(db, "recipes", "servings", "TEXT");
  ensureColumn(db, "recipes", "metadata_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "recipes", "normalized_ingredients", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "recipes", "image", "TEXT");
  ensureColumn(db, "recipes", "refresh_requested_at", "TEXT");

  const insert = db.prepare(`
    INSERT INTO recipes (url, title, fetched_at)
    VALUES (@url, @title, @fetchedAt)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title,
      fetched_at = excluded.fetched_at
  `);
  const updateMetadata = db.prepare(`
    UPDATE recipes
    SET title = COALESCE(@title, title),
        categories = @categories,
        ingredients = @ingredients,
        normalized_ingredients = @normalizedIngredients,
        cook_time = @cookTime,
        servings = @servings,
        image = @image,
        metadata_version = @metadataVersion,
        enrichment_status = 'enriched',
        refresh_requested_at = NULL,
        enriched_at = @enrichedAt
    WHERE url = @url
  `);
  const selectAll = db.prepare(`
    SELECT id, url, title, categories, ingredients, normalized_ingredients, cook_time, servings, image, metadata_version, enrichment_status, refresh_requested_at, fetched_at, enriched_at
    FROM recipes
    ORDER BY title ASC
  `);
  const selectPending = db.prepare(`
    SELECT url
    FROM recipes
    WHERE enrichment_status != 'enriched'
       OR metadata_version < @metadataVersion
       OR (
         refresh_requested_at IS NOT NULL
         AND (enriched_at IS NULL OR refresh_requested_at >= enriched_at)
       )
    ORDER BY id ASC
  `);
  const markVersion = db.prepare(`
    UPDATE recipes
    SET metadata_version = @metadataVersion
    WHERE url = @url
  `);
  const markRefreshRequested = db.prepare(`
    UPDATE recipes
    SET refresh_requested_at = @refreshRequestedAt
    WHERE url = @url
  `);

  return {
    upsertRecipes(recipes) {
      const tx = db.transaction((rows) => {
        for (const recipe of rows) {
          insert.run({
            url: recipe.url,
            title: recipe.title,
            fetchedAt: new Date().toISOString()
          });
        }
      });
      tx(recipes);
    },
    updateMetadata(url, metadata) {
      updateMetadata.run({
        url,
        title: metadata.name ?? null,
        categories: JSON.stringify(metadata.categories ?? []),
        ingredients: JSON.stringify(metadata.ingredients ?? []),
        normalizedIngredients: JSON.stringify(
          metadata.normalizedIngredients ??
            normalizeRecipeIngredients(metadata.ingredients ?? [])
        ),
        cookTime: metadata.cookTime ?? null,
        servings: metadata.servings ?? null,
        image: metadata.image ?? null,
        metadataVersion: CURRENT_METADATA_VERSION,
        enrichedAt: new Date().toISOString()
      });
    },
    listRecipes() {
      return selectAll.all().map(mapRow);
    },
    listPendingRecipeUrls() {
      return selectPending
        .all({ metadataVersion: CURRENT_METADATA_VERSION })
        .map((row) => row.url);
    },
    markMetadataVersion(url, metadataVersion) {
      markVersion.run({ url, metadataVersion });
    },
    markRefreshRequested(urls = []) {
      const tx = db.transaction((values) => {
        const refreshRequestedAt = new Date().toISOString();
        for (const url of values) {
          markRefreshRequested.run({ url, refreshRequestedAt });
        }
      });
      tx(urls);
    },
    close() {
      db.close();
    }
  };
}

function ensureColumn(db, tableName, columnName, columnType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

function mapRow(row) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    categories: JSON.parse(row.categories),
    ingredients: JSON.parse(row.ingredients),
    normalizedIngredients: JSON.parse(row.normalized_ingredients),
    cookTime: row.cook_time,
    servings: row.servings,
    image: row.image ?? null,
    metadataVersion: row.metadata_version,
    enrichmentStatus: row.enrichment_status,
    refreshRequestedAt: row.refresh_requested_at,
    fetchedAt: row.fetched_at,
    enrichedAt: row.enriched_at
  };
}
