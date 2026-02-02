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
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

async function fetchTitle(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Waygate/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return url;
    const html = await response.text();
    const $ = cheerio.load(html);
    return $("title").text().trim() || url;
  } catch {
    return url;
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

  // Fetch title in background, update when complete
  fetchTitle(body.item).then((title) => {
    db.prepare("UPDATE items SET title = ? WHERE id = ?").run(title, id);
  });

  return c.json({ id, item: body.item, title: body.item }, 201);
});

app.get("/items", (c) => {
  const stmt = db.prepare("SELECT id, item, title, createdAt FROM items ORDER BY createdAt DESC");
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
