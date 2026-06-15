import type OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import type { MemoryUnit } from "./types";

export class MemoryCompressor {
  private openai: OpenAI;
  private model: string;

  constructor(openaiInstance: OpenAI, model: string = "gpt-4o-mini") {
    this.openai = openaiInstance;
    this.model = model;
  }

  async extractMemories(userId: string, chatHistory: any[]): Promise<MemoryUnit[]> {
    const prompt = `
Analyze the following chat history and extract important facts, user preferences, or key decisions.
Return the result as a JSON array of objects with the following structure:
[
  {
    "content": "The extracted fact or preference",
    "entities": ["entity1", "entity2"],
    "importance_score": 8
  }
]
Only extract information that would be useful for future conversations. If nothing is important, return an empty array [].
Importance score should be between 1 and 10.

Chat History:
${JSON.stringify(chatHistory, null, 2)}
`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: "system", content: prompt }],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0].message.content;
      if (!content) return [];

      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed) ? parsed : parsed.memories || parsed.items || [];

      return items.map((item: any) => ({
        id: uuidv4(),
        userId,
        content: item.content,
        entities: item.entities || [],
        importance_score: item.importance_score || 5,
        timestamp: Date.now(),
      }));
    } catch (error) {
      console.error("Failed to extract memories:", error);
      return [];
    }
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error("Failed to get embedding:", error);
      return [];
    }
  }
}
