import type { Expect } from "bun:test";

type Subprocess = Bun.Subprocess<"pipe", "pipe", "inherit">;

const testEnv = {
  ...process.env,
  NODE_ENV: "test",
  WS_PORT: "3100",
  UDP_PORT: "3101",
  TEST_BROADCAST_ADDR: "127.255.255.255",
} as const;

class ProcessSession {
  #pendingBuffer = "";
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #sessionName: string;
  #sessionHistory = "";
  #process: Subprocess;

  #encoder = new TextEncoder();
  #decoder = new TextDecoder();

  constructor(process: Subprocess, sessionName: string) {
    this.#process = process;
    this.#reader = process.stdout.getReader();
    this.#sessionName = sessionName;
    void this.#startReading();
  }

  /**
   * Spawns a new game instance running the local index file with test configurations
   * and wraps it in a ProcessSession instance.
   */
  static spawn(sessionName: string): ProcessSession {
    const process = Bun.spawn(["bun", "run", "./src/index.ts"], {
      env: testEnv,
      stdin: "pipe",
      stdout: "pipe",
    });
    return new ProcessSession(process, sessionName);
  }

  async #startReading() {
    while (true) {
      const { value, done } = await this.#reader.read();
      if (done) break;
      const text = this.#decoder.decode(value, { stream: true });
      this.#pendingBuffer += text;
      this.#sessionHistory += text;
    }
  }

  async waitFor(expectedOutput: string, timeoutMs = 4000): Promise<string> {
    const startTime = Date.now();
    while (!this.#pendingBuffer.includes(expectedOutput)) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          `Timeout waiting for console output phrase: "${expectedOutput}"\nCurrent Buffer State:\n${this.#pendingBuffer}`,
        );
      }
      await Bun.sleep(50);
    }

    const matchIndex = this.#pendingBuffer.indexOf(expectedOutput);
    const matchedSegment = this.#pendingBuffer.slice(
      0,
      matchIndex + expectedOutput.length,
    );
    this.#pendingBuffer = this.#pendingBuffer.slice(
      matchIndex + expectedOutput.length,
    );
    return matchedSegment;
  }

  async write(text: string) {
    this.#sessionHistory += `[INPUT:${text}]\n`;
    const bytes = this.#encoder.encode(`${text}\n`);
    await this.#process.stdin.write(bytes);
  }

  end(expect: Expect) {
    expect(this.#sessionHistory).toMatchSnapshot(`[${this.#sessionName}]`);
    this.#process.kill();
  }
}

export { ProcessSession, testEnv };
