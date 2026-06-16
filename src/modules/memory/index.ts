import { Honcho } from "@honcho-ai/sdk";

export class MemoryManager {
  private honcho: Honcho;

  constructor() {
    // Initialize Honcho client
    // It will automatically use process.env.HONCHO_API_KEY if available
    this.honcho = new Honcho({
      workspaceId: process.env.HONCHO_WORKSPACE_ID,
      apiKey: process.env.HONCHO_API_KEY,
    });
  }

  async processChatHistory(userId: string, chatHistory: any[]) {
    const user = await this.honcho.peer(userId);
    const assistant = await this.honcho.peer("assistant");
    
    // Use a session per user to group their history
    const session = await this.honcho.session(`session_${userId}`);
    await session.addPeers([user, assistant]);

    const messages = [];
    for (const msg of chatHistory) {
      if (msg.role === "user") {
        messages.push(user.message(msg.content));
      } else if (msg.role === "assistant") {
        messages.push(assistant.message(msg.content));
      }
    }

    if (messages.length > 0) {
      await session.addMessages(messages);
    }
  }

  async backfillHistory(userId: string, allMessages: any[]) {
    // This method can be called to ingest historical data from SQLite
    // It processes messages in chunks to avoid hitting API limits
    console.log(`[Honcho] Starting backfill for user ${userId} (${allMessages.length} messages)`);
    const user = await this.honcho.peer(userId);
    const assistant = await this.honcho.peer("assistant");
    const session = await this.honcho.session(`session_${userId}`);
    await session.addPeers([user, assistant]);

    const chunkSize = 50;
    for (let i = 0; i < allMessages.length; i += chunkSize) {
      console.log(`[Honcho] Processing chunk ${i} to ${Math.min(i + chunkSize, allMessages.length)}...`);
      const chunk = allMessages.slice(i, i + chunkSize);
      const messages = [];
      
      for (const msg of chunk) {
        if (msg.role === "user" && msg.content) {
          const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          messages.push(user.message(content));
        } else if (msg.role === "assistant" && msg.content) {
          const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          messages.push(assistant.message(content));
        }
      }

      if (messages.length > 0) {
        await session.addMessages(messages);
        // Add a small delay between chunks to prevent rate limiting
        if (i + chunkSize < allMessages.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    console.log(`[Honcho] Backfill completed for user ${userId}`);
  }

  async getRelevantContext(userId: string, query: string, topK: number = 3): Promise<any[]> {
    const session = await this.honcho.session(`session_${userId}`);
    const assistant = await this.honcho.peer("assistant");
    
    try {
      // Get context from Honcho with summary enabled for long conversations
      // We also use semantic search to find conclusions relevant to the user's query
      const context = await session.context({ 
        summary: true, 
        tokens: 2000,
        peerTarget: userId,
        representationOptions: {
          searchQuery: query,
          searchTopK: topK
        }
      });
      const openaiMessages = context.toOpenAI(assistant);
      
      return openaiMessages;
    } catch (error) {
      console.error("Failed to get context from Honcho:", error);
      return [];
    }
  }
}

export * from "./types";

