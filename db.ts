import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const dbPath = path.join(process.cwd(), "luoyun.db");
const db = new DatabaseSync(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT,
    content TEXT NOT NULL,
    isAiGenerated INTEGER DEFAULT 0,
    promptUsed TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS progress (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

export interface Chapter {
  id: number;
  title: string;
  subtitle: string;
  content: string;
  isAiGenerated?: boolean;
  promptUsed?: string;
}

export function getSyncState() {
  try {
    // Get chapters
    const chaptersQuery = db.prepare("SELECT * FROM chapters ORDER BY id ASC");
    const chaptersRaw = chaptersQuery.all() as any[];
    const chapters: Chapter[] = chaptersRaw.map(row => ({
      id: row.id,
      title: row.title,
      subtitle: row.subtitle || "",
      content: row.content,
      isAiGenerated: row.isAiGenerated === 1,
      promptUsed: row.promptUsed || undefined
    }));

    // Get progress keys
    const progressQuery = db.prepare("SELECT * FROM progress");
    const progressRaw = progressQuery.all() as any[];
    
    let selectedId = 1;
    let fateOptions: string[] = [];

    for (const row of progressRaw) {
      if (row.key === "selectedId") {
        selectedId = parseInt(row.value, 10) || 1;
      } else if (row.key === "fateOptions") {
        try {
          fateOptions = JSON.parse(row.value);
        } catch (e) {
          fateOptions = [];
        }
      }
    }

    return { chapters, selectedId, fateOptions };
  } catch (e) {
    console.error("[Database] Error reading sync state:", e);
    return { chapters: [], selectedId: 1, fateOptions: [] };
  }
}

export function saveSyncState(chapters: Chapter[], selectedId: number, fateOptions: string[]) {
  try {
    // We run this sequence of writes. 
    // Clear chapters first
    db.exec("DELETE FROM chapters");
    
    // Insert new chapters
    const insertChapter = db.prepare(`
      INSERT INTO chapters (id, title, subtitle, content, isAiGenerated, promptUsed)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const chap of chapters) {
      insertChapter.run(
        chap.id,
        chap.title,
        chap.subtitle || "",
        chap.content,
        chap.isAiGenerated ? 1 : 0,
        chap.promptUsed || null
      );
    }

    // Update progress table
    const upsertProgress = db.prepare(`
      INSERT INTO progress (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    upsertProgress.run("selectedId", selectedId.toString());
    upsertProgress.run("fateOptions", JSON.stringify(fateOptions));

    return true;
  } catch (e) {
    console.error("[Database] Error saving sync state:", e);
    throw e;
  }
}
