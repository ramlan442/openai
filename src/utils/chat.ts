import type OpenAI from "openai";
import { randomUUID } from "crypto";
import db from "./db";

type MessageWithId = OpenAI.Chat.ChatCompletionMessageParam & { id: string };

export const buildMessage = (
  id: string, // id ini sekarang tidak dipakai untuk DB, tapi tetap di-return untuk kompatibilitas
  message: OpenAI.Chat.ChatCompletionMessageParam[] | null,
  {
    msgId,
    systemMessage,
    history,
    userId = "default_user",
  }: {
    msgId?: string;
    systemMessage?: string;
    history?: OpenAI.Chat.ChatCompletionMessageParam[];
    userId?: string;
  } = {},
) => {
  // Fetch existing messages for this user
  const getMessages = db.prepare(
    "SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC"
  );
  const rows = getMessages.all(userId) as any[];

  let msg: MessageWithId[] = rows.map((row) => {
    let parsedContent = row.content;
    if (typeof row.content === "string" && (row.content.startsWith("[") || row.content.startsWith("{"))) {
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

  // Always prepend system message
  if (systemMessage) {
    msg.unshift({ content: systemMessage, role: "system", id: "system" });
  }

  // Add new user messages if provided
  if (message) {
    const newMessages = message.map((v) => ({ ...v, id: randomUUID() }));
    
    // Kita tidak push newMessages ke msg di sini, 
    // karena kita ingin urutannya: system -> db -> history -> user message
    // Jadi kita simpan dulu untuk di-append nanti di return

    const insertMsg = db.prepare(`
      INSERT INTO messages (id, user_id, role, content, tool_calls, function_call, name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((msgs: MessageWithId[]) => {
      for (const m of msgs) {
        insertMsg.run(
          m.id,
          userId,
          m.role,
          m.content || null,
          (m as any).tool_calls ? JSON.stringify((m as any).tool_calls) : null,
          (m as any).function_call ? JSON.stringify((m as any).function_call) : null,
          (m as any).name || null,
          Date.now()
        );
      }
    });

    insertMany(newMessages);

    // Handle truncation if msgId is provided
    if (msgId) {
      const index = msg.findIndex((v) => v.id === msgId);
      if (index !== -1) {
        msg = msg.slice(0, index + 1);
        // Delete messages after msgId from DB
        const deleteAfter = db.prepare(`
          DELETE FROM messages 
          WHERE user_id = ? AND created_at > (
            SELECT created_at FROM messages WHERE id = ?
          )
        `);
        deleteAfter.run(userId, msgId);
      }
    }
  }

  return {
    id,
    messages: [
      ...msg.map((v) => {
        const { id: _id, ...rest } = v;
        return rest;
      }),
      ...(history || []),
      ...(message || []),
    ] as OpenAI.Chat.ChatCompletionMessageParam[],
    saveMessage: (newMessage: MessageWithId) => {
      const insertMsg = db.prepare(`
        INSERT INTO messages (id, user_id, role, content, tool_calls, function_call, name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
