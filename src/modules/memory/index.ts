import type OpenAI from "openai";
import { MemoryStore } from "./store";
import { MemoryCompressor } from "./compressor";
import type { MemoryUnit } from "./types";

export class MemoryManager {
  private store: MemoryStore;
  private compressor: MemoryCompressor;
  private isInitialized = false;

  constructor(openaiInstance: OpenAI, dbPath?: string) {
    this.store = new MemoryStore(dbPath);
    this.compressor = new MemoryCompressor(openaiInstance);
  }

  async init() {
    if (!this.isInitialized) {
      await this.store.init();
      this.isInitialized = true;
    }
  }

  async processChatHistory(userId: string, chatHistory: any[]) {
    await this.init();
    
    // 1. Extract memories using LLM
    const memories = await this.compressor.extractMemories(userId, chatHistory);
    
    // 2. Get embeddings and store
    for (const memory of memories) {
      const vector = await this.compressor.getEmbedding(memory.content);
      if (vector.length > 0) {
        await this.store.addMemory({
          ...memory,
          vector,
        });
      }
    }
  }

  async getRelevantContext(userId: string, query: string, topK: number = 3): Promise<string> {
    await this.init();
    
    const queryVector = await this.compressor.getEmbedding(query);
    if (queryVector.length === 0) return "";

    const memories = await this.store.searchMemories(userId, query, queryVector, topK);
    
    if (memories.length === 0) return "";

    const contextStr = memories
      .map((m) => `- ${m.content} (Entities: ${m.entities.join(", ")})`)
      .join("\n");

    return `\n[Relevant Past Memories]\n${contextStr}\n`;
  }
}

export * from "./types";
export * from "./store";
export * from "./compressor";
