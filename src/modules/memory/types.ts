export interface MemoryUnit {
  id: string;
  userId: string;
  content: string;
  entities: string[];
  timestamp: number;
  importance_score: number;
}

export interface MemoryItem extends MemoryUnit {
  vector: number[];
}
