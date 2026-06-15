import { LocalIndex } from "vectra";
import path from "path";
import fs from "fs";
import type { MemoryItem, MemoryUnit } from "./types";

export class MemoryStore {
  private index: LocalIndex;

  constructor(dbPath: string = "memory_db") {
    const fullPath = path.resolve(process.cwd(), dbPath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    this.index = new LocalIndex(fullPath);
  }

  async init() {
    if (!(await this.index.isIndexCreated())) {
      await this.index.createIndex();
    }
  }

  async addMemory(memory: MemoryItem) {
    await this.index.insertItem({
      id: memory.id,
      vector: memory.vector,
      metadata: {
        userId: memory.userId,
        content: memory.content,
        entities: memory.entities.join(","),
        timestamp: memory.timestamp,
        importance_score: memory.importance_score,
      },
    });
  }

  async searchMemories(userId: string, query: string, queryVector: number[], topK: number = 5): Promise<MemoryUnit[]> {
    // Filter by userId
    const filter = { userId: { $eq: userId } };
    const results = await this.index.queryItems(queryVector, query, topK, filter);
    
    return results.map((res) => ({
      id: res.item.id,
      userId: res.item.metadata.userId as string,
      content: res.item.metadata.content as string,
      entities: (res.item.metadata.entities as string).split(","),
      timestamp: res.item.metadata.timestamp as number,
      importance_score: res.item.metadata.importance_score as number,
    }));
  }
}
