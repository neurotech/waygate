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
    favicon TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

interface Metadata {
  title: string;
  favicon: string | null;
}

async function fetchMetadata(url: string): Promise<Metadata> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Waygate/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { title: url, favicon: null };
    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $("title").text().trim() || url;

    let favicon =
      $('link[rel="icon"]').attr("href") ||
      $('link[rel="shortcut icon"]').attr("href") ||
      null;

    if (favicon && !favicon.startsWith("http")) {
      favicon = new URL(favicon, url).href;
    }

    if (!favicon) {
      favicon = new URL("/favicon.ico", url).href;
    }

    return { title, favicon };
  } catch {
    return { title: url, favicon: null };
  }
}

const app = new Hono();

app.post("/items", async (c) => {
  const body = await c.req.json<{ item: string }>();
  if (!body.item) {
    return c.json({ error: "item is required" }, 400);
  }
  const stmt = db.prepare("INSERT INTO items (item, title, favicon) VALUES (?, ?, ?)");
  const result = stmt.run(body.item, body.item, null);
  const id = result.lastInsertRowid;

  // Fetch metadata in background, update when complete
  fetchMetadata(body.item).then(({ title, favicon }) => {
    db.prepare("UPDATE items SET title = ?, favicon = ? WHERE id = ?").run(title, favicon, id);
  });

  return c.json({ id, item: body.item, title: body.item, favicon: null }, 201);
});

app.get("/items", (c) => {
  const stmt = db.prepare("SELECT id, item, title, favicon, createdAt FROM items ORDER BY createdAt DESC");
  const items = stmt.all();
  return c.json(items);
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
