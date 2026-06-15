import { randomUUID } from "crypto";
import type { FunctionOpenAI } from "../types";

// eslint-disable-next-line import/prefer-default-export
export function buildRequestBody(config: {
  messages: any[];
  model: string;
  tools?: FunctionOpenAI[];
  functions?: FunctionOpenAI[];
  stream: boolean;
}): any {
  const { messages, model, tools, functions, stream } = config;

  const body: any = {
    messages,
    user: randomUUID(),
    model,
    stream,
  };

  if (tools) {
    body.tools = tools.map((v) => ({
      ...v,
      function: { ...v.function, path: undefined },
    }));
  }

  if (functions) {
    body.functions = functions.map((v) => ({
      ...v,
      path: undefined,
      task: undefined,
    }));
    delete body.tools;
  }

  return body;
}
