import type OpenAI from "openai";

export interface OpenAIType {
  chatCompletions: (
    text: string,
    opts?: {
      headers?: any;
      model?: OpenAI.Chat.ChatCompletionCreateParams["model"];
      endpoint?: string;
      tools?: Array<FunctionOpenAI>;
      functions?: Array<FunctionOpenAI>;
      images?: string[];
      onMessage?: (data: any) => void;
      onFunctionCall?: (
        arg: string,
        fn: FunctionOpenAI,
        save: (content: string) => Promise<any>,
      ) => Promise<any>;
    },
  ) => Promise<ChatResponse>;
}

export interface FunctionOpenAI {
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: {
        [id: string]: {
          type: "number" | "string" | "boolean";
          description: string;
          enum?: string[];
        };
      };
      required: string[];
    };
    path?: string;
    task?: (args: any) => Promise<any>;
  };
  type: "function";
  response?: string;
}

export type ChatResponse = OpenAI.ChatCompletion & {
  text: string | null;
  tool_call?: OpenAI.ChatCompletionMessageToolCall;
};
