import { createParser } from "eventsource-parser";
import { ErrorMessage } from "./error";

async function* streamAsyncIterable<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

// eslint-disable-next-line import/prefer-default-export
export async function fetchSSE(
  url: string,
  options: Parameters<typeof fetch>[1] & {
    onMessage: (data: string) => void;
    onError?: (error: unknown) => void;
    onFinish?: (d: boolean) => void;
  },
  fetch = globalThis.fetch,
) {
  const { onMessage, onError, onFinish, ...fetchOptions } = options;
  const res = await fetch(url, fetchOptions);
  if (!res.ok) {
    let reason: string;

    try {
      reason = await res.text();
    } catch (err) {
      reason = res.statusText;
    }

    const msg = `ChatGPT error ${res.status}: ${reason}`;
    const error = new ErrorMessage(msg);
    error.statusCode = res.status;
    error.statusText = res.statusText;
    throw error;
  }

  const parser = createParser({
    onEvent(event: any) {
      if (event.type === "event") {
        onMessage(event.data);
      }
    }
  });

  // handle special response errors
  const feed = (chunk: string) => {
    let response = null;

    try {
      response = JSON.parse(chunk);
    } catch {
      // ignore
    }

    if (response?.detail?.type === "invalid_request_error") {
      const msg = `ChatGPT error ${response.detail.message}: ${response.detail.code} (${response.detail.type})`;
      const error = new ErrorMessage(msg);
      error.statusCode = response.detail.code;
      error.statusText = response.detail.message;

      if (onError) {
        onError(error);
      } else {
        console.error(error);
      }

      // don't feed to the event parser
      return;
    }

    parser.feed(chunk);
  };

  if (!res.body?.getReader) {
    // Vercel polyfills `fetch` with `node-fetch`, which doesn't conform to
    // web standards, so this is a workaround...
    const { body }: { body: NodeJS.ReadableStream } = res as never;

    if (!body.on || !body.read) {
      throw new ErrorMessage('unsupported "fetch" implementation');
    }

    body.on("readable", () => {
      const chunk: string | Buffer = body.read();
      while (chunk !== null) {
        feed(chunk.toString());
      }
    });
    body.on("close", () => onFinish?.(true));
    body.on("error", () => onFinish?.(true));
    body.on("end", () => onFinish?.(true));
  } else {
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of streamAsyncIterable(res.body)) {
      const str = new TextDecoder().decode(chunk);
      feed(str);
    }
  }
}
