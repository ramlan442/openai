import { randomUUID } from "crypto";
import type { ChatResponse, FunctionOpenAI } from "../types";

export type ChatFn = (text: string | null, opts: any) => Promise<ChatResponse>;

type SaveMessage = (msg: any) => void;

export async function handleToolCalls(
  toolCalls: any[],
  tools: FunctionOpenAI[],
  saveMessage: SaveMessage,
  onFunctionCall?: (
    arg: string,
    fn: FunctionOpenAI,
    save: (content: string) => Promise<any>,
  ) => Promise<any>,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax
  for (const tool of toolCalls) {
    const {
      function: { arguments: arg, name },
      id: idTool,
    } = tool;
    const fn = tools.find((v) => v.function.name === name);
    if (!fn) continue;

    if (typeof onFunctionCall === "function") {
      // eslint-disable-next-line no-await-in-loop
      await onFunctionCall(arg, fn, async (contentFunction) => {
        saveMessage({
          tool_call_id: idTool,
          id: randomUUID(),
          role: "tool",
          content: contentFunction,
        });
        return () => {};
      });
    } else {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const fnc = require(fn.function.path!);

      saveMessage({
        tool_call_id: idTool,
        id: randomUUID(),
        role: "tool",
        // eslint-disable-next-line no-await-in-loop
        content: await fnc[fn.function.name](JSON.parse(arg)),
      });
    }
  }
}

export async function handleFunctionCall(
  functionCall: any,
  content: string | null,
  role: string,
  functions: FunctionOpenAI[],
  saveMessage: SaveMessage,
  chatFn: ChatFn,
  opts: any,
  id: string,
  onFunctionCall?: (
    arg: string,
    fn: FunctionOpenAI,
    save: (content: string) => Promise<any>,
  ) => Promise<any>,
): Promise<ChatResponse | null> {
  const fn = functions.find((v) => v.function.name === functionCall.name);
  if (!fn) return null;

  if (typeof onFunctionCall === "function") {
    fn.response = content ?? undefined;
    // eslint-disable-next-line no-await-in-loop
    return onFunctionCall(
      functionCall.arguments!,
      fn,
      async (contentFunction) => {
        saveMessage({
          id: randomUUID(),
          role,
          content: content || "done",
          function_call: functionCall,
        });
        saveMessage({
          id: randomUUID(),
          role: "function",
          content: contentFunction,
          name: functionCall.name,
        });
        return chatFn(null, { ...opts, parentMessageId: id });
      },
    );
  }

  saveMessage({
    id: randomUUID(),
    role,
    content: content || "done",
    function_call: functionCall,
  });
  saveMessage({
    id: randomUUID(),
    role: "function",
    // eslint-disable-next-line no-await-in-loop
    content: await fn.function.task!(JSON.parse(functionCall.arguments!)),
    name: functionCall.name,
  });
  return chatFn(null, { ...opts, parentMessageId: id });
}
