import axios from "axios";
import { randomUUID } from "crypto";
import OpenAI from "openai";
import type { ChatResponse, FunctionOpenAI } from "./types";
import { buildMessage } from "./utils";
import {
  buildRequestBody,
  sendStreamRequest,
  sendNonStreamRequest,
  handleToolCalls,
  handleFunctionCall,
} from "./modules";
import { MemoryManager } from "./modules/memory";

class OpenAi {
  private BASE_URL = "https://api.openai.com";

  private CHATGPT_MODEL = "gpt-4o";

  private SYSTEM_MESSAGE = "You are a helpful assistant.";

  private memoryManager?: MemoryManager;

  private DEFAULT_HEADERS = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Content-Type": "application/json",
  } as any;

  constructor({
    key,
    systemMessage,
    enableMemory = false,
    memoryDbPath,
  }: { 
    key?: string; 
    systemMessage?: string;
    enableMemory?: boolean;
    memoryDbPath?: string;
  } = {}) {
    if (key) this.DEFAULT_HEADERS.authorization = `Bearer ${key}`;
    if (systemMessage) this.SYSTEM_MESSAGE = systemMessage;
    
    if (enableMemory) {
      // We need to pass an OpenAI instance to the memory manager for embeddings/extraction
      const openaiInstance = new OpenAI({ apiKey: key || process.env.OPENAI_API_KEY });
      this.memoryManager = new MemoryManager(openaiInstance, memoryDbPath);
    }
  }

  private buildUserMessage(text: string, images?: string[]) {
    return {
      role: "user" as const,
      content: images
        ? ([
            { type: "text", text },
            ...images.map((image) => ({
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${image}` },
            })),
          ] as any)
        : text,
    };
  }

  async chatCompletions(
    text: string | null,
    opts: {
      headers?: any;
      model?: OpenAI.Chat.ChatCompletionCreateParams["model"];
      endpoint?: string;
      parentMessageId?: string;
      chatMessageId?: string;
      tools?: Array<FunctionOpenAI>;
      functions?: Array<FunctionOpenAI>;
      images?: string[];
      history?: OpenAI.Chat.ChatCompletionMessageParam[];
      userId?: string;
      onMessage?: (data: any) => void;
      onFunctionCall?: (
        arg: string,
        fn: FunctionOpenAI,
        save: (content: string) => Promise<any>,
      ) => Promise<any>;
    } = {},
  ): Promise<ChatResponse> {
    const {
      headers,
      model,
      endpoint,
      onMessage,
      onFunctionCall,
      images,
      history,
      userId,
      tools,
      functions,
      chatMessageId,
      parentMessageId,
    } = opts;

    const chatUrl = endpoint || `${this.BASE_URL}/v1/chat/completions`;
    const useStream = !!onMessage;

    // 1. Build messages
    const userMessage = text ? [this.buildUserMessage(text, images)] : null;
    
    // Inject relevant memory context if memory manager is initialized
    let systemMsg = this.SYSTEM_MESSAGE;
    const effectiveUserId = userId || "default_user";
    
    if (this.memoryManager && text) {
      const context = await this.memoryManager.getRelevantContext(effectiveUserId, text);
      if (context) {
        systemMsg += context;
      }
    }

    const { messages, saveMessage, id } = buildMessage(
      parentMessageId || randomUUID(),
      userMessage,
      { systemMessage: systemMsg, msgId: chatMessageId, history, userId: effectiveUserId },
    );

    // 2. Build request body
    const body = buildRequestBody({
      messages,
      model: model || this.CHATGPT_MODEL,
      tools,
      functions,
      stream: useStream,
    });

    console.log(JSON.stringify(body,null, 2))

    // 3. Send request
    const requestHeaders = headers || this.DEFAULT_HEADERS;
    const chatMessageResponse = useStream
      ? await sendStreamRequest(
          chatUrl,
          JSON.stringify(body),
          requestHeaders,
          id,
          onMessage!,
        )
      : await sendNonStreamRequest(
          chatUrl,
          JSON.stringify(body),
          requestHeaders,
        );

    // 4. Extract response
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { content, role, tool_calls, function_call } =
      (chatMessageResponse.choices[0] as any).Message ||
      chatMessageResponse.choices[0].message;
    chatMessageResponse.id = id;
    chatMessageResponse.text = content;
    console.log(chatMessageResponse.choices[0].message)

    saveMessage({ id: randomUUID(), role, content, tool_calls });

    // 5. Handle tool calls
    if (tool_calls) {
      await handleToolCalls(tool_calls, tools!, saveMessage, onFunctionCall);
      return this.chatCompletions(null, { ...opts, parentMessageId: id });
    }

    // 6. Handle function call
    if (function_call) {
      const result = await handleFunctionCall(
        function_call,
        content,
        role,
        functions!,
        saveMessage,
        (t, o) => this.chatCompletions(t, o),
        opts,
        id,
        onFunctionCall,
      );
      if (result) return result;
    }

    // 7. Process memory in background (if enabled)
    if (this.memoryManager && text) {
      // We don't await this to avoid blocking the response
      this.memoryManager.processChatHistory(effectiveUserId, [
        { role: "user", content: text },
        { role: "assistant", content: content || "" }
      ]).catch(err => console.error("Memory processing failed:", err));
    }

    return chatMessageResponse;
  }

  async transcribe(
    file: Buffer,
    {
      lang,
      model,
      baseUrl,
      headers,
    }: {
      baseUrl?: string;
      headers?: any;
      lang?: string;
      model?: string;
    } = {},
  ) {
    const endpoint = baseUrl || `${this.BASE_URL}/v1/audio/transcriptions`;

    const blob = new Blob([file], { type: "audio/mpeg" });
    const formData = new FormData();
    formData.append("file", blob, "audio.mp3");
    formData.append("model", model || "whisper-1");
    formData.append("language", lang || "id");

    const res = await axios.post(endpoint, formData, {
      headers: headers || {
        ...this.DEFAULT_HEADERS,
        "Content-Type": "multipart/form-data",
      },
    });

    return res.data;
  }
}

export default OpenAi;
