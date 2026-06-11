import { expect, test, describe } from "bun:test";

type Subprocess = Bun.Subprocess<"pipe", "pipe", "inherit">;

class ProcessSession {
  private pendingBuffer = "";
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private sessionName: string;
  private sessionHistory = "";
  private process: Subprocess;

  private encoder = new TextEncoder();

  constructor(process: Subprocess, sessionName: string) {
    this.process = process;
    this.reader = process.stdout.getReader();
    this.sessionName = sessionName;
    void this.startReading();
  }

  private async startReading() {
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await this.reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      this.pendingBuffer += text;
      this.sessionHistory += text;
    }
  }

  async waitFor(expectedOutput: string, timeoutMs = 4000): Promise<string> {
    const startTime = Date.now();
    while (!this.pendingBuffer.includes(expectedOutput)) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          `Timeout waiting for console output phrase: "${expectedOutput}"\nCurrent Buffer State:\n${this.pendingBuffer}`,
        );
      }
      await Bun.sleep(50);
    }

    const matchIndex = this.pendingBuffer.indexOf(expectedOutput);
    const matchedSegment = this.pendingBuffer.slice(
      0,
      matchIndex + expectedOutput.length,
    );
    this.pendingBuffer = this.pendingBuffer.slice(
      matchIndex + expectedOutput.length,
    );
    return matchedSegment;
  }

  async write(text: string) {
    this.sessionHistory += `[INPUT:${text}]\n`;
    const bytes = this.encoder.encode(`${text}\n`);
    await this.process.stdin.write(bytes);
  }

  assertAndTeardown() {
    expect(this.sessionHistory).toMatchSnapshot(`[${this.sessionName}]`);
    this.process.kill();
  }
}

const testEnv = {
  ...process.env,
  NODE_ENV: "test",
  WS_PORT: "3100",
  UDP_PORT: "3101",
  TEST_BROADCAST_ADDR: "127.255.255.255",
};

describe("Multiplayer Tic-Tac-Toe E2E Suite", () => {
  test("Full Game Loop: Player X Wins over LAN", async () => {
    const hostProcess = Bun.spawn(["bun", "run", "./src/index.ts"], {
      env: testEnv,
      stdin: "pipe",
      stdout: "pipe",
    });
    const clientProcess = Bun.spawn(["bun", "run", "./src/index.ts"], {
      env: testEnv,
      stdin: "pipe",
      stdout: "pipe",
    });

    const hostSession = new ProcessSession(hostProcess, "host");
    const clientSession = new ProcessSession(clientProcess, "client");

    // --- INITIAL CONNECTION ---
    await hostSession.waitFor("Choose an option (1-3):");
    await hostSession.write("1");
    await hostSession.waitFor("Room active.");

    await clientSession.waitFor("Choose an option (1-3):");
    await clientSession.write("2");

    await clientSession.waitFor("Would you like to join this game? (y/n):");
    await clientSession.write("y");

    // --- TURN 1: Player X plays Position 1 ---
    await hostSession.waitFor("Your move! Enter a position (1-9):");
    await hostSession.write("1");

    // Both nodes must render Turn 1 before we proceed
    await hostSession.waitFor("Waiting for opponent's move...");
    await clientSession.waitFor("Your move! Enter a position (1-9):");

    // --- TURN 2: Player O plays Position 4 ---
    await clientSession.write("4");

    // Both nodes must render Turn 2 before we proceed
    await hostSession.waitFor("Your move! Enter a position (1-9):");
    await clientSession.waitFor("Waiting for opponent's move...");

    // --- TURN 3: Player X plays Position 2 ---
    await hostSession.write("2");

    // Both nodes must render Turn 3 before we proceed
    await hostSession.waitFor("Waiting for opponent's move...");
    await clientSession.waitFor("Your move! Enter a position (1-9):");

    // --- TURN 4: Player O plays Position 5 ---
    await clientSession.write("5");

    // Both nodes must render Turn 4 before we proceed
    await hostSession.waitFor("Your move! Enter a position (1-9):");
    await clientSession.waitFor("Waiting for opponent's move...");

    // --- TURN 5: Player X plays Position 3 (WINNING MOVE) ---
    await hostSession.write("3");

    // --- SNAPSHOT ASSERTIONS ---
    await hostSession.waitFor("Player X wins! 🎉");
    await clientSession.waitFor("Player X wins! 🎉");

    hostSession.assertAndTeardown();
    clientSession.assertAndTeardown();
  });
});
