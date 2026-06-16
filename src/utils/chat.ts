import type OpenAI from "openai";
import { randomUUID } from "crypto";
import db from "./db";

type MessageWithId = OpenAI.Chat.ChatCompletionMessageParam & { id: string };

export const buildMessage = async (
  id: string, // id ini sekarang tidak dipakai untuk DB, tapi tetap di-return untuk kompatibilitas
  message: OpenAI.Chat.ChatCompletionMessageParam[] | null,
  {
    msgId,
    systemMessage,
    fetchRelevantContext,
    triggerBackfill,
    history,
    userId = "default_user",
    maxHistory = 10,
  }: {
    msgId?: string;
    systemMessage?: string;
    fetchRelevantContext?: () => Promise<string>;
    triggerBackfill?: (allMessages: any[]) => Promise<void>;
    history?: OpenAI.Chat.ChatCompletionMessageParam[];
    userId?: string;
    maxHistory?: number;
  } = {},
) => {
  // 1. Handle truncation FIRST if msgId is provided
  if (msgId) {
    const deleteAfter = db.prepare(`
      DELETE FROM messages 
      WHERE user_id = ? AND created_at > (
        SELECT created_at FROM messages WHERE id = ?
      )
    `);
    deleteAfter.run(userId, msgId);
  }

  // 2. Get total count of messages for this user
  const countRow = db.prepare("SELECT COUNT(*) as count FROM messages WHERE user_id = ?").get(userId) as { count: number };
  const totalMessages = countRow.count;

  // 3. Fetch limited messages (last N messages)
  const getMessages = db.prepare(
    "SELECT * FROM (SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC"
  );
  const rows = getMessages.all(userId, maxHistory) as any[];

  // 3.5 Backfill to Honcho if needed (Triggered when totalMessages > maxHistory)
  let allRowsForBackfill: any[] = [];

  if (totalMessages > maxHistory && fetchRelevantContext) {
    const getUnsynced = db.prepare("SELECT * FROM messages WHERE user_id = ? AND honcho_synced = 0 ORDER BY created_at ASC");
    allRowsForBackfill = getUnsynced.all(userId) as any[];
    
    if (allRowsForBackfill.length > maxHistory) {
      console.log(`[Honcho] Found ${allRowsForBackfill.length} unsynced messages for user ${userId}. Marking as synced...`);
      // Mark as synced immediately to prevent concurrent backfills
      const markSynced = db.prepare("UPDATE messages SET honcho_synced = 1 WHERE id = ?");
      const markMany = db.transaction((rows: any[]) => {
        for (const row of rows) markSynced.run(row.id);
      });
      markMany(allRowsForBackfill);
    }
  }

  let msg: MessageWithId[] = rows.map((row) => {
    let parsedContent = row.content;
    if (typeof row.content === "string" && row.content.startsWith("[") && row.role === "user") {
      try {
        parsedContent = JSON.parse(row.content);
      } catch (e) {
        // ignore
      }
    }

    const baseMsg: any = {
      id: row.id,
      role: row.role,
      content: parsedContent,
    };
    if (row.tool_calls) baseMsg.tool_calls = JSON.parse(row.tool_calls);
    if (row.function_call) baseMsg.function_call = JSON.parse(row.function_call);
    if (row.name) baseMsg.name = row.name;
    return baseMsg;
  });

  // 4. Insert new user messages to DB if provided
  if (message) {
    const newMessages = message.map((v) => ({ ...v, id: randomUUID() }));
    
    const insertMsg = db.prepare(`
      INSERT INTO messages (id, user_id, role, content, tool_calls, function_call, name, created_at, honcho_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    const insertMany = db.transaction((msgs: MessageWithId[]) => {
      for (const m of msgs) {
        insertMsg.run(
          m.id,
          userId,
          m.role,
          m.content ? (typeof m.content === "string" ? m.content : JSON.stringify(m.content)) : null,
          (m as any).tool_calls ? JSON.stringify((m as any).tool_calls) : null,
          (m as any).function_call ? JSON.stringify((m as any).function_call) : null,
          (m as any).name || null,
          Date.now()
        );
      }
    });

    insertMany(newMessages);
  }

  // 5. Compose final messages array
  const finalMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  // - System message
  if (systemMessage) {
    finalMessages.push({ role: "system", content: systemMessage });
  }

  // - History (from DB, limited to maxHistory)
  finalMessages.push(...msg.map((v) => {
    const { id: _id, ...rest } = v;
    return rest;
  }));

  // - History (from args)
  if (history) {
    finalMessages.push(...history);
  }

  // - Relevant context (Honcho) - ONLY if total messages > maxHistory
  if (totalMessages > maxHistory && fetchRelevantContext) {
    // Trigger backfill if provided and needed
    if (triggerBackfill && allRowsForBackfill.length > maxHistory) {
      console.log(`[Honcho] Triggering background backfill for ${allRowsForBackfill.length} messages...`);
      // We don't await this so it runs in the background
      triggerBackfill(allRowsForBackfill).catch(err => {
        console.error("[Honcho] Backfill failed:", err);
        console.log(`[Honcho] Reverting sync status for ${allRowsForBackfill.length} messages...`);
        // Revert the backfill status if it failed so we can try again later
        const markUnsynced = db.prepare("UPDATE messages SET honcho_synced = 0 WHERE id = ?");
        const revertMany = db.transaction((rows: any[]) => {
          for (const row of rows) markUnsynced.run(row.id);
        });
        revertMany(allRowsForBackfill);
      });
    }

    console.log(`[Honcho] Fetching relevant context for user ${userId}...`);
    const relevantContext = await fetchRelevantContext();
    if (relevantContext) {
      console.log(`[Honcho] Context received:`, relevantContext);
      finalMessages.push({ role: "system", content: relevantContext });
    } else {
      console.log(`[Honcho] No relevant context found.`);
    }
  }

  // - User message
  if (message) {
    finalMessages.push(...message);
  }

  return {
    id,
    messages: finalMessages,
    saveMessage: (newMessage: MessageWithId) => {
      const insertMsg = db.prepare(`
        INSERT INTO messages (id, user_id, role, content, tool_calls, function_call, name, created_at, honcho_synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `);
      insertMsg.run(
        newMessage.id || randomUUID(),
        userId,
        newMessage.role,
        newMessage.content ? (typeof newMessage.content === "string" ? newMessage.content : JSON.stringify(newMessage.content)) : null,
        (newMessage as any).tool_calls ? JSON.stringify((newMessage as any).tool_calls) : null,
        (newMessage as any).function_call ? JSON.stringify((newMessage as any).function_call) : null,
        (newMessage as any).name || null,
        Date.now()
      );
    },
  };
};
