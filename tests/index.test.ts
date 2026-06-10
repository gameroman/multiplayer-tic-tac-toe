import { expect, test, describe } from "bun:test";

type Subprocess = Bun.Subprocess<"pipe", "pipe", "inherit">;

class ProcessStreamWatcher {
  private buffer = "";
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private name: string;
  private feed = "";
  private proc: Subprocess;

  private encoder = new TextEncoder();

  constructor(proc: Subprocess, name: string) {
    this.proc = proc;
    this.reader = proc.stdout.getReader();
    this.name = name;
    void this.startReading();
  }

  private async startReading() {
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await this.reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      this.buffer += text;
      this.feed += text;
    }
  }

  async waitFor(targetText: string, timeoutMs = 4000): Promise<string> {
    const start = Date.now();
    while (!this.buffer.includes(targetText)) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timeout waiting for console output phrase: "${targetText}"\nCurrent Buffer State:\n${this.buffer}`,
        );
      }
      await Bun.sleep(50);
    }

    const matchIndex = this.buffer.indexOf(targetText);
    const matchedSegment = this.buffer.slice(0, matchIndex + targetText.length);
    this.buffer = this.buffer.slice(matchIndex + targetText.length);
    return matchedSegment;
  }

  async write(text: string) {
    this.feed += `[INPUT:${text}]\n`;
    const bytes = this.encoder.encode(`${text}\n`);
    await this.proc.stdin.write(bytes);
  }

  end() {
    expect(this.feed).toMatchSnapshot(`[${this.name}]`);
    this.proc.kill();
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
    const host = Bun.spawn(["bun", "run", "./src/index.ts"], {
      env: testEnv,
      stdin: "pipe",
      stdout: "pipe",
    });
    const client = Bun.spawn(["bun", "run", "./src/index.ts"], {
      env: testEnv,
      stdin: "pipe",
      stdout: "pipe",
    });

    const hostLog = new ProcessStreamWatcher(host, "host");
    const clientLog = new ProcessStreamWatcher(client, "client");

    // --- INITIAL CONNECTION ---
    await hostLog.waitFor("Choose an option (1-3):");
    await hostLog.write("1");
    await hostLog.waitFor("Room active.");

    await clientLog.waitFor("Choose an option (1-3):");
    await clientLog.write("2");

    await clientLog.waitFor("Would you like to join this game? (y/n):");
    await clientLog.write("y");

    // --- TURN 1: Player X plays Position 1 ---

    await hostLog.waitFor("Your move! Enter a position (1-9):");
    await hostLog.write("1");

    // Both nodes must render Turn 1 before we proceed

    await hostLog.waitFor("Waiting for opponent's move...");

    await clientLog.waitFor("Your move! Enter a position (1-9):");

    // --- TURN 2: Player O plays Position 4 ---
    await clientLog.write("4");

    // Both nodes must render Turn 2 before we proceed

    await hostLog.waitFor("Your move! Enter a position (1-9):");

    await clientLog.waitFor("Waiting for opponent's move...");

    // --- TURN 3: Player X plays Position 2 ---
    await hostLog.write("2");

    // Both nodes must render Turn 3 before we proceed

    await hostLog.waitFor("Waiting for opponent's move...");

    await clientLog.waitFor("Your move! Enter a position (1-9):");

    // --- TURN 4: Player O plays Position 5 ---
    await clientLog.write("5");

    // Both nodes must render Turn 4 before we proceed

    await hostLog.waitFor("Your move! Enter a position (1-9):");

    await clientLog.waitFor("Waiting for opponent's move...");

    // --- TURN 5: Player X plays Position 3 (WINNING MOVE) ---
    await hostLog.write("3");

    // --- SNAPSHOT ASSERTIONS ---
    await hostLog.waitFor("Player X wins! 🎉");
    await clientLog.waitFor("Player X wins! 🎉");

    hostLog.end();
    clientLog.end();
  });
});
