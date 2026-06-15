import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

const dbDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, "chat.db");
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    tool_calls TEXT,
    function_call TEXT,
    name TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
`);

export default db;
