import axios from "axios";
import type OpenAI from "openai";
import type { ChatResponse } from "../types";
import { fetchSSE } from "../utils";

export function sendStreamRequest(
  chatUrl: string,
  body: string,
  headers: any,
  id: string,
  onMessage: (data: any) => void,
): Promise<ChatResponse> {
  return new Promise<ChatResponse>((resolve, reject) => {
    const response: ChatResponse = {} as any;
    let prevIndex = 0;
    let nextIndex = 100;

    fetchSSE(chatUrl, {
      onMessage: (data) => {
        if (data === "[DONE]") {
          if (response.choices[0].message.content) {
            onMessage(
              response.choices[0].message.content.slice(prevIndex, nextIndex),
            );
          }
          resolve(response);
          return;
        }
        try {
          const res: OpenAI.ChatCompletionChunk = JSON.parse(data);
          response.id = id;
          if (res.created) response.created = res.created;
          if (res.model) response.model = res.model;

          if (res.choices?.length) {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const { delta, finish_reason, index, logprobs } =
              res.choices[0];
            if (!response.choices) {
              response.choices = [
                {
                  message: {
                    content: "",
                    role: "assistant",
                    refusal: null,
                  },
                  finish_reason: finish_reason as any,
                  index,
                  logprobs: logprobs as any,
                },
              ];
            }
            if (delta?.content) {
              const { content } = delta;
              response.choices[0].message.content += content;
              const tt = response.choices[0].message.content!;
              if (tt.length > nextIndex) {
                const textSlice = tt.slice(prevIndex, nextIndex);
                prevIndex = nextIndex;
                nextIndex += 100;
                onMessage(textSlice);
              }
              // onMessage(tt);
            }
            if (delta.tool_calls) {
              if (!response.choices[0].message.tool_calls) {
                response.choices[0].message.tool_calls =
                  delta.tool_calls as any;
              }

              const rtol = response.choices[0].message.tool_calls;
              let responseTool: OpenAI.ChatCompletionChunk.Choice.Delta.ToolCall =
                rtol![rtol!.length - 1] as any;
              const resTool = delta.tool_calls[0];

              if (responseTool.index !== resTool.index) {
                response.choices[0].message.tool_calls!.push(
                  resTool as any,
                );
                responseTool = rtol![rtol!.length - 1] as any;
              }

              responseTool.function!.arguments +=
                resTool.function!.arguments!;
            }
            if (finish_reason)
              response.choices[0].finish_reason = finish_reason;
            if (index) response.choices[0].index = index;
            if (logprobs) response.choices[0].logprobs = logprobs;
          }
        } catch (err) {
          console.warn("OpenAI stream SSE event unexpected error", err);
          reject(err);
        }
      },
      body,
      method: "POST",
      headers,
      onFinish: () => {
        response.id = id;
        resolve(response);
      },
      onError(error) {
        reject(error);
      },
    }).catch(reject);
  });
}

export function sendNonStreamRequest(
  chatUrl: string,
  body: string,
  headers: any,
): Promise<ChatResponse> {
  return new Promise((resolve, reject) => {
    axios
      .post(chatUrl, body, {
        headers,
      })
      .then((res) => resolve(res.data))
      .catch((res) => {
        console.error(body);
        console.error(res.response?.data, res);
        reject("res");
      });
  });
}
