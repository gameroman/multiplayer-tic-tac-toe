import { expect, test, describe } from "bun:test";
import { ProcessSession } from "./shared";

describe("Multiplayer Tic-Tac-Toe E2E Suite - Spectator Flow", () => {
  test("Third connected node defaults to a spectator role", async () => {
    const hostSession = ProcessSession.spawn("host");
    const clientSession = ProcessSession.spawn("client");
    const spectatorSession = ProcessSession.spawn("spectator");

    // --- STEP 1: Host creates the room ---
    await hostSession.waitFor("Choose an option (1-3):");
    await hostSession.write("1");
    await hostSession.waitFor("Room active.");

    // --- STEP 2: Player 2 searches for the game ---
    await clientSession.waitFor("Choose an option (1-3):");
    await clientSession.write("2");
    await clientSession.waitFor("Would you like to join this game? (y/n):");

    // --- STEP 3: Spectator searches for the game ---
    await spectatorSession.waitFor("Choose an option (1-3):");
    await spectatorSession.write("2");
    await spectatorSession.waitFor("Would you like to join this game? (y/n):");

    // --- STEP 4: Player 2 confirms and joins ---
    await clientSession.write("y");
    await clientSession.waitFor("Waiting for opponent's move...");

    // --- STEP 5: Spectator confirms and joins ---
    await spectatorSession.write("y");
    await spectatorSession.waitFor("[📺 SPECTATOR]");

    // --- GAME LOOP BEGINS ---

    // --- TURN 1: Player X plays Position 1 ---
    await hostSession.waitFor("Your move! Enter a position (1-9):");
    await hostSession.write("1");

    // Verify all nodes (including the spectator) see the game updates progressing
    await hostSession.waitFor("Waiting for opponent's move...");
    await clientSession.waitFor("Your move! Enter a position (1-9):");

    // --- TURN 2: Player O plays Position 4 ---
    await clientSession.write("4");

    await hostSession.waitFor("Your move! Enter a position (1-9):");
    await clientSession.waitFor("Waiting for opponent's move...");

    // --- TURN 3: Player X plays Position 2 ---
    await hostSession.write("2");

    await hostSession.waitFor("Waiting for opponent's move...");
    await clientSession.waitFor("Your move! Enter a position (1-9):");

    // --- TURN 4: Player O plays Position 5 ---
    await clientSession.write("5");

    await hostSession.waitFor("Your move! Enter a position (1-9):");
    await clientSession.waitFor("Waiting for opponent's move...");

    // --- TURN 5: Player X plays Position 3 (WINNING MOVE) ---
    await hostSession.write("3");

    // --- SNAPSHOT ASSERTIONS ---
    await hostSession.waitFor("Player X wins! 🎉");
    await clientSession.waitFor("Player X wins! 🎉");
    await spectatorSession.waitFor("Player X wins! 🎉");

    hostSession.end(expect);
    clientSession.end(expect);
    spectatorSession.end(expect);
  }, 15000);
});
