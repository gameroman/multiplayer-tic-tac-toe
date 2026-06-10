import { createInterface } from "node:readline";
import dgram from "node:dgram";

const WS_PORT = 3000;
const UDP_PORT = 3001;
const BROADCAST_ADDR = "255.255.255.255";

type CurrentTurn = "X" | "O";
type PlayerType = CurrentTurn | "SPECTATOR";

type BoardSymbol = string;
type BoardRow = [BoardSymbol, BoardSymbol, BoardSymbol];
type Board = [BoardRow, BoardRow, BoardRow];

const ROW_COLUMN = [0, 1, 2] as const;
type CellRowColumn = (typeof ROW_COLUMN)[number];

let currentTurn: CurrentTurn = "X";
let assignedSymbol: PlayerType | null = null;
let gameStarted = false;
let board: Board = [
  [" ", " ", " "],
  [" ", " ", " "],
  [" ", " ", " "],
];

// Track active players/spectators to assign roles reliably
let connectedPlayers: Bun.ServerWebSocket<undefined>[] = [];

const rl = createInterface({ input: process.stdin, output: process.stdout });

// ==========================================
// GAME LOGIC HELPERS
// ==========================================
function drawBoard() {
  console.clear();

  if (assignedSymbol === "SPECTATOR") {
    console.log(`\n  You are:        [📺 SPECTATOR]`);
  } else {
    console.log(`\n  You are Player: [${assignedSymbol}]`);
  }

  if (!gameStarted) {
    console.log(`  Status:         [Waiting for opponent to join...]\n`);
  } else {
    console.log(`  Current Turn:   [${currentTurn}]\n`);
  }

  // Create a display representation of the board
  const displayBoard = board.map((row) => [...row]) as Board;

  // If the user is an active player, inject position numbers into empty spots
  if (assignedSymbol === "X" || assignedSymbol === "O") {
    for (const r of ROW_COLUMN) {
      for (const c of ROW_COLUMN) {
        if (displayBoard[r][c] === " ") {
          const positionNumber = r * 3 + c + 1;
          displayBoard[r][c] = positionNumber.toString();
        }
      }
    }
  }

  console.log(`   +---+---+---+`);
  console.log(
    `   | ${displayBoard[0][0]} | ${displayBoard[0][1]} | ${displayBoard[0][2]} |`,
  );
  console.log(`   +---+---+---+`);
  console.log(
    `   | ${displayBoard[1][0]} | ${displayBoard[1][1]} | ${displayBoard[1][2]} |`,
  );
  console.log(`   +---+---+---+`);
  console.log(
    `   | ${displayBoard[2][0]} | ${displayBoard[2][1]} | ${displayBoard[2][2]} |`,
  );
  console.log(`   +---+---+---+\n`);
}

function checkGameOver() {
  for (const i of ROW_COLUMN) {
    if (
      board[i][0] !== " " &&
      board[i][0] === board[i][1] &&
      board[i][0] === board[i][2]
    )
      return board[i][0];
    if (
      board[0][i] !== " " &&
      board[0][i] === board[1][i] &&
      board[0][i] === board[2][i]
    )
      return board[0][i];
  }
  if (
    board[0][0] !== " " &&
    board[0][0] === board[1][1] &&
    board[0][0] === board[2][2]
  )
    return board[0][0];
  if (
    board[0][2] !== " " &&
    board[0][2] === board[1][1] &&
    board[0][2] === board[2][0]
  )
    return board[0][2];
  if (board.flat().every((cell) => cell !== " ")) return "draw";
  return null;
}

function promptMove(ws: WebSocket) {
  if (!gameStarted) return;

  if (currentTurn !== assignedSymbol) {
    console.log("Waiting for opponent's move...");
    return;
  }

  rl.question("Your move! Enter a position (1-9): ", (input) => {
    const position = parseInt(input.trim(), 10);

    if (isNaN(position) || position < 1 || position > 9) {
      console.log("Invalid input! Please enter a number between 1 and 9.");
      promptMove(ws);
      return;
    }

    // Map 1-9 to 2D board coordinates (row, col)
    const r = Math.floor((position - 1) / 3) as CellRowColumn;
    const c = (position - 1) % 3;

    if (board[r][c] !== " ") {
      console.log("That spot is already taken! Try again.");
      promptMove(ws);
      return;
    }

    ws.send(JSON.stringify({ type: "MOVE", r, c, player: assignedSymbol }));
  });
}

// ==========================================
// NETWORKING LAYERS
// ==========================================
function startHost() {
  console.log("\nSetting up the game room...");

  const server = Bun.serve({
    port: WS_PORT,
    hostname: "0.0.0.0",
    fetch(req, srv) {
      if (srv.upgrade(req)) return;
      return new Response("Expected WebSocket", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.subscribe("game");
        connectedPlayers.push(ws);

        let symbol: PlayerType;
        if (connectedPlayers.length === 1) {
          symbol = "X";
        } else if (connectedPlayers.length === 2) {
          symbol = "O";
        } else {
          symbol = "SPECTATOR";
        }

        ws.send(JSON.stringify({ type: "ASSIGN", symbol }));

        if (connectedPlayers.length === 2) {
          server.publish("game", JSON.stringify({ type: "START" }));
          connectedPlayers[0]!.send(JSON.stringify({ type: "START" }));
        } else if (connectedPlayers.length > 2 && gameStarted) {
          // Instantly catch up late spectators to current board environment
          ws.send(JSON.stringify({ type: "START" }));
          ws.send(JSON.stringify({ type: "SYNC_BOARD", board, currentTurn }));
        }
      },
      message(ws, message) {
        try {
          const data = JSON.parse(message.toString());
          // Security block: Don't let accidental spectators inject layout alterations
          if (data.type === "MOVE" && data.player === "SPECTATOR") {
            return;
          }
        } catch {
          return;
        }
        server.publish("game", message);
        ws.send(message);
      },
      close(ws) {
        const leavingIndex = connectedPlayers.indexOf(ws);
        connectedPlayers = connectedPlayers.filter((p) => p !== ws);

        // If a competitor (Player 1 or Player 2) leaves, dump the game loop safely
        if (gameStarted && (leavingIndex === 0 || leavingIndex === 1)) {
          server.publish(
            "game",
            JSON.stringify({
              type: "ERROR",
              message: "An active competitor abandoned the match. Game over.",
            }),
          );
          gameStarted = false;
          board = [
            [" ", " ", " "],
            [" ", " ", " "],
            [" ", " ", " "],
          ];
          currentTurn = "X";
        }
      },
    },
  });

  let udpSocket: dgram.Socket | null = dgram.createSocket("udp4");

  udpSocket.bind(0, () => {
    if (udpSocket) udpSocket.setBroadcast(true);
  });

  const broadcastInterval = setInterval(() => {
    if (udpSocket) {
      const message = Buffer.from("TIC_TAC_TOE_HOST");
      udpSocket.send(
        message,
        0,
        message.length,
        UDP_PORT,
        BROADCAST_ADDR,
        () => {},
      );
    }
  }, 1000);

  console.log("Room active. Broadcasting availability to LAN...");

  connectToGame("localhost", () => {
    clearInterval(broadcastInterval);
    setTimeout(() => {
      if (udpSocket) {
        try {
          udpSocket.close();
        } catch {}
        udpSocket = null;
      }
    }, 0);
  });
}

function startClientDiscovery() {
  console.log("\nSearching local network for active games...");
  const udpSocket = dgram.createSocket("udp4");
  let foundHost = false;

  const timeout = setTimeout(() => {
    if (!foundHost) {
      console.log("No games found on your local network.");
      udpSocket.close();
      showMainMenu();
    }
  }, 5000);

  udpSocket.on("message", (msg, rinfo) => {
    if (msg.toString() === "TIC_TAC_TOE_HOST" && !foundHost) {
      foundHost = true;
      clearTimeout(timeout);
      udpSocket.close();

      console.log(`Found a game room at IP: ${rinfo.address}!`);
      rl.question("Would you like to join this game? (y/n): ", (answer) => {
        if (answer.toLowerCase().startsWith("y")) {
          connectToGame(rinfo.address);
        } else {
          showMainMenu();
        }
      });
    }
  });

  udpSocket.bind(UDP_PORT);
}

function connectToGame(ip: string, onOpponentJoin?: () => void) {
  const socket = new WebSocket(`ws://${ip}:${WS_PORT}`);
  let spectatorInputHandler: ((chunk: Buffer) => void) | null = null;

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data.toString());

    if (data.type === "ASSIGN" && !assignedSymbol) {
      assignedSymbol = data.symbol;
      drawBoard();

      if (assignedSymbol === "SPECTATOR") {
        setupSpectatorExit(socket);
      }
    }

    if (data.type === "START") {
      gameStarted = true;
      if (onOpponentJoin) onOpponentJoin();
      drawBoard();

      if (assignedSymbol !== "SPECTATOR") {
        promptMove(socket);
      } else {
        console.log(
          "🍿 Watching live match... Press [Q] to leave viewing mode.",
        );
      }
    }

    if (data.type === "SYNC_BOARD") {
      board = data.board;
      currentTurn = data.currentTurn;
      drawBoard();
      console.log("🍿 Watching live match... Press [Q] to leave viewing mode.");
    }

    if (data.type === "MOVE") {
      board[data.r as CellRowColumn][data.c] = data.player;
      currentTurn = data.player === "X" ? "O" : "X";
      drawBoard();

      const winner = checkGameOver();
      if (winner) {
        cleanupSpectatorInput();
        console.log(
          winner === "draw"
            ? "Game Over! It's a tie match."
            : `Game Over! Player ${winner} wins! 🎉`,
        );
        rl.close();
        socket.close();
        process.exit(0);
      }

      if (assignedSymbol !== "SPECTATOR") {
        promptMove(socket);
      } else {
        console.log(
          "🍿 Watching live match... Press [Q] to leave viewing mode.",
        );
      }
    }

    if (data.type === "ERROR") {
      cleanupSpectatorInput();
      console.clear();
      console.log(`\n❌ ${data.message}`);
      socket.close();
      // Gracefully recycle player loop parameters back to local selection
      assignedSymbol = null;
      gameStarted = false;
      board = [
        [" ", " ", " "],
        [" ", " ", " "],
        [" ", " ", " "],
      ];
      currentTurn = "X";
      setTimeout(showMainMenu, 2500);
    }
  });

  function setupSpectatorExit(ws: WebSocket) {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    spectatorInputHandler = (chunk: Buffer) => {
      const key = chunk.toString();
      if (key.toLowerCase() === "q" || key === "\u0003") {
        cleanupSpectatorInput();
        ws.close();

        // Wipe instance indicators before falling back to main screen layout
        assignedSymbol = null;
        gameStarted = false;
        board = [
          [" ", " ", " "],
          [" ", " ", " "],
          [" ", " ", " "],
        ];
        currentTurn = "X";
        showMainMenu();
      }
    };

    process.stdin.on("data", spectatorInputHandler);
  }

  function cleanupSpectatorInput() {
    if (spectatorInputHandler) {
      process.stdin.removeListener("data", spectatorInputHandler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      spectatorInputHandler = null;
    }
  }

  socket.addEventListener("error", () => {
    cleanupSpectatorInput();
    console.error("Failed to connect to the game room.");
    setTimeout(showMainMenu, 2000);
  });
}

// ==========================================
// UI / MAIN MENU
// ==========================================
function showMainMenu() {
  console.clear();
  console.log("=== MULTIPLAYER TIC-TAC-TOE ===");
  console.log("1. Host a new game");
  console.log("2. Search and join an existing game");
  console.log("3. Exit");

  rl.question("\nChoose an option (1-3): ", (choice) => {
    switch (choice.trim()) {
      case "1":
        startHost();
        break;
      case "2":
        startClientDiscovery();
        break;
      case "3":
        rl.close();
        process.exit(0);
        break;
      default:
        console.log("Invalid choice.");
        setTimeout(showMainMenu, 1000);
    }
  });
}

showMainMenu();
