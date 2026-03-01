/**
 * Global type declarations for runtime APIs available across
 * Node.js, Deno, Bun, and Cloudflare Workers.
 *
 * We declare these minimally rather than pulling in @types/node
 * or DOM lib to keep the library runtime-agnostic.
 */

declare class AsyncLocalStorage<T> {
  constructor();
  run<R>(store: T, callback: () => R): R;
  getStore(): T | undefined;
}

// Console is available in all JS runtimes
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

// Request is available in Node 18+, Deno, Bun, CF Workers (Web API)
declare class Request {
  constructor(input: string | Request, init?: RequestInit);
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  clone(): Request;
}

declare class Headers {
  constructor(init?: Record<string, string>);
  get(name: string): string | null;
  set(name: string, value: string): void;
  has(name: string): boolean;
  delete(name: string): void;
}

interface RequestInit {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: string | ArrayBuffer | ReadableStream<Uint8Array> | null;
}

interface ReadableStream<R = Uint8Array> {
  readonly locked: boolean;
  getReader(): ReadableStreamDefaultReader<R>;
}

interface ReadableStreamDefaultReader<R = Uint8Array> {
  read(): Promise<{ done: boolean; value?: R }>;
  releaseLock(): void;
}
