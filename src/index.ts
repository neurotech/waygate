import { Hono } from "hono";
import { serve } from "@hono/node-server";
import Database from "better-sqlite3";
import * as cheerio from "cheerio";

const db = new Database(process.env.DB_PATH || "./data/items.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item TEXT NOT NULL,
    title TEXT NOT NULL,
    favicon_data BLOB,
    favicon_type TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migration for existing databases with old schema
try { db.exec("ALTER TABLE items ADD COLUMN favicon_data BLOB"); } catch {}
try { db.exec("ALTER TABLE items ADD COLUMN favicon_type TEXT"); } catch {}

interface Metadata {
  title: string;
  faviconData: Buffer | null;
  faviconType: string | null;
}

async function fetchFavicon(
  url: string
): Promise<{ data: Buffer | null; type: string | null }> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Waygate/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { data: null, type: null };
    const type = response.headers.get("content-type") || "image/x-icon";
    const arrayBuffer = await response.arrayBuffer();
    return { data: Buffer.from(arrayBuffer), type };
  } catch {
    return { data: null, type: null };
  }
}

async function fetchMetadata(url: string): Promise<Metadata> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Waygate/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { title: url, faviconData: null, faviconType: null };
    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $("title").text().trim() || url;

    let faviconUrl =
      $('link[rel="icon"]').attr("href") ||
      $('link[rel="shortcut icon"]').attr("href") ||
      null;

    if (faviconUrl && !faviconUrl.startsWith("http")) {
      faviconUrl = new URL(faviconUrl, url).href;
    }

    if (!faviconUrl) {
      faviconUrl = new URL("/favicon.ico", url).href;
    }

    const { data, type } = await fetchFavicon(faviconUrl);
    return { title, faviconData: data, faviconType: type };
  } catch {
    return { title: url, faviconData: null, faviconType: null };
  }
}

const app = new Hono();

app.post("/items", async (c) => {
  const body = await c.req.json<{ item: string }>();
  if (!body.item) {
    return c.json({ error: "item is required" }, 400);
  }
  const stmt = db.prepare("INSERT INTO items (item, title) VALUES (?, ?)");
  const result = stmt.run(body.item, body.item);
  const id = result.lastInsertRowid;

  fetchMetadata(body.item).then(({ title, faviconData, faviconType }) => {
    db.prepare("UPDATE items SET title = ?, favicon_data = ?, favicon_type = ? WHERE id = ?")
      .run(title, faviconData, faviconType, id);
  });

  return c.json({ id, item: body.item, title: body.item, favicon: null }, 201);
});

app.get("/items", (c) => {
  const stmt = db.prepare(
    "SELECT id, item, title, favicon_data IS NOT NULL AS has_favicon, createdAt FROM items ORDER BY createdAt DESC"
  );
  const items = (stmt.all() as any[]).map((row) => ({
    id: row.id,
    item: row.item,
    title: row.title,
    favicon: row.has_favicon ? `/favicons/${row.id}` : null,
    createdAt: row.createdAt,
  }));
  return c.json(items);
});

app.get("/favicons/:id", (c) => {
  const id = c.req.param("id");
  const row = db.prepare("SELECT favicon_data, favicon_type FROM items WHERE id = ?").get(id) as any;
  if (!row?.favicon_data) {
    return c.notFound();
  }
  return new Response(row.favicon_data, {
    headers: {
      "Content-Type": row.favicon_type || "image/x-icon",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

app.delete("/items/:id", (c) => {
  const id = c.req.param("id");
  const stmt = db.prepare("DELETE FROM items WHERE id = ?");
  const result = stmt.run(id);
  if (result.changes === 0) {
    return c.json({ error: "Item not found" }, 404);
  }
  return c.json({ success: true });
});

const port = 8008;
console.log(`Server running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
