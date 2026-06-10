import { expect, test, describe } from "bun:test";

class ProcessStreamWatcher {
  private buffer = "";
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
    void this.startReading();
  }

  private async startReading() {
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await this.reader.read();
      if (done) break;
      this.buffer += decoder.decode(value, { stream: true });
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
    expect(`[${targetText}]\n\n${matchedSegment}`).toMatchSnapshot();
    return matchedSegment;
  }
}

const testEnv = {
  ...process.env,
  NODE_ENV: "test",
  WS_PORT: "3100",
  UDP_PORT: "3101",
  TEST_BROADCAST_ADDR: "127.255.255.255",
};

const encoder = new TextEncoder();

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

    const hostLog = new ProcessStreamWatcher(host.stdout);
    const clientLog = new ProcessStreamWatcher(client.stdout);

    // --- INITIAL CONNECTION ---
    await hostLog.waitFor("Choose an option (1-3):");
    await host.stdin.write(encoder.encode("1\n"));
    await hostLog.waitFor("Room active.");

    await clientLog.waitFor("Choose an option (1-3):");
    await client.stdin.write(encoder.encode("2\n"));

    await clientLog.waitFor("Would you like to join this game? (y/n):");
    await client.stdin.write(encoder.encode("y\n"));

    // --- TURN 1: Player X plays Position 1 ---

    await hostLog.waitFor("Your move! Enter a position (1-9):");
    await host.stdin.write(encoder.encode("1\n"));

    // Both nodes must render Turn 1 before we proceed

    await hostLog.waitFor("Waiting for opponent's move...");

    await clientLog.waitFor("Your move! Enter a position (1-9):");

    // --- TURN 2: Player O plays Position 4 ---
    await client.stdin.write(encoder.encode("4\n"));

    // Both nodes must render Turn 2 before we proceed

    await hostLog.waitFor("Your move! Enter a position (1-9):");

    await clientLog.waitFor("Waiting for opponent's move...");

    // --- TURN 3: Player X plays Position 2 ---
    await host.stdin.write(encoder.encode("2\n"));

    // Both nodes must render Turn 3 before we proceed

    await hostLog.waitFor("Waiting for opponent's move...");

    await clientLog.waitFor("Your move! Enter a position (1-9):");

    // --- TURN 4: Player O plays Position 5 ---
    await client.stdin.write(encoder.encode("5\n"));

    // Both nodes must render Turn 4 before we proceed

    await hostLog.waitFor("Your move! Enter a position (1-9):");

    await clientLog.waitFor("Waiting for opponent's move...");

    // --- TURN 5: Player X plays Position 3 (WINNING MOVE) ---
    await host.stdin.write(encoder.encode("3\n"));

    // --- SNAPSHOT ASSERTIONS ---
    await hostLog.waitFor("Player X wins! 🎉");
    await clientLog.waitFor("Player X wins! 🎉");

    host.kill();
    client.kill();
  }, 20000);
});
