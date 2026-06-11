import { expect, test, describe } from "bun:test";
import { ProcessSession } from "./shared";

describe("Multiplayer Tic-Tac-Toe E2E Suite", () => {
  test("Full Game Loop: Player X Wins over LAN", async () => {
    const hostSession = ProcessSession.spawn("host");
    const clientSession = ProcessSession.spawn("client");

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

    hostSession.end(expect);
    clientSession.end(expect);
  });
});
