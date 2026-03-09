const express = require("express"); 
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const fs = require("fs");
const path = require("path");

app.use(express.static("public"));

// Load English words
let englishWords = new Set();
fs.readFile(path.join(__dirname, "public", "words.txt"), "utf8", (err, data) => {
  if (err) console.error("Error loading word list:", err);
  else {
    englishWords = new Set(data.split(/\r?\n/).map(w => w.toUpperCase()));
    console.log("English words loaded:", englishWords.size);
  }
});

// Leaderboard
let leaderboard = {};
const leaderboardPath = path.join(__dirname, "leaderboard.json");
if (fs.existsSync(leaderboardPath)) {
  leaderboard = JSON.parse(fs.readFileSync(leaderboardPath, "utf8"));
} else {
  fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboard, null, 2));
}

// Game settings
const startingTimer = 15;
const minTimer = 5;
const combos = [
  "BA","CA","DA","MA","PA","RA","TA","BE","BI","BO","BU","LA","LE","LI","LO",
  "AN","IN","ON","UN","BL","CL","FL","GL","PL","SL","BR","CR","DR","FR","GR",
  "PR","TR","SC","SK","SL","SM","SN","SP","ST","SW","WH","WR"
];

const rooms = {}; 
let currentRandomRoom = null; 

function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// --- Start next turn ---
function nextTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted || room.playerOrder.length === 0) return;
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.playerOrder.length;
  const activeId = room.playerOrder[room.currentPlayerIndex];
  room.activePlayerId = activeId;
  startPrompt(roomCode);
}

function startPrompt(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted || room.playerOrder.length === 0) return;

  room.currentPrompt = combos[Math.floor(Math.random() * combos.length)];
  const activeId = room.playerOrder[room.currentPlayerIndex];
  room.activePlayerId = activeId;

  io.to(roomCode).emit("newPrompt", {
    prompt: room.currentPrompt,
    timer: room.timer,
    activePlayer: activeId
  });

  io.to(roomCode).emit("updatePlayers", room.players);

  clearInterval(room.timerInterval);
  let timeLeft = room.timer;
  io.to(roomCode).emit("timer", timeLeft);

  room.timerInterval = setInterval(() => {
    timeLeft--;
    io.to(roomCode).emit("timer", timeLeft);

    if (timeLeft <= 0) {
      clearInterval(room.timerInterval);

      const player = room.players[activeId];
      if (player) {
        player.lives--;

        // Notify the player who lost the life
        const s = io.sockets.sockets.get(activeId);
        if (s) {
          s.emit("lifeLost", {
            reason: "Time ran out!",
            lives: player.lives
          });
        }

        if (player.lives <= 0) {
          delete room.players[activeId];
          room.playerOrder = room.playerOrder.filter(id => id !== activeId);
        }
      }

      io.to(roomCode).emit("updatePlayers", room.players);
      checkWinner(roomCode);
      nextTurn(roomCode);
    }
  }, 1000);
}

// --- Check winner and reset room ---
function checkWinner(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const remaining = Object.values(room.players).filter(p => p.lives > 0);

  if (remaining.length === 1) {
    const winner = remaining[0];

    if (!leaderboard[winner.name]) leaderboard[winner.name] = { longestWord: 0, longestWordText: "", wins: 0 };
    leaderboard[winner.name].wins += 1;
    fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboard, null, 2));

    io.to(roomCode).emit("gameOver", { winner: winner.name, leaderboard });

    // --- Reset room and players ---
    room.gameStarted = false;
    clearInterval(room.timerInterval);
    Object.values(room.players).forEach(p => { p.ready = false; p.startPressed = false; });
    Object.keys(room.players).forEach(id => {
      const s = io.sockets.sockets.get(id);
      if (s) s.roomCode = null;
    });
    room.queue = [];
    room.playerOrder = [];
    room.currentPlayerIndex = -1;

    // Reset the random room code so a new game will have a fresh code
    if (currentRandomRoom === roomCode) currentRandomRoom = null;
  }
}

// --- Socket.io ---
io.on("connection", (socket) => {
  console.log("User connected", socket.id);

  socket.on("joinRoom", ({ name, code, random }) => {
    let roomCode;

    if (random) {
      if (!currentRandomRoom || rooms[currentRandomRoom].playerOrder.length >= 7) {
        currentRandomRoom = generateRoomCode();
        rooms[currentRandomRoom] = { players: {}, playerOrder: [], queue: [], gameStarted: false, timer: startingTimer };
      }
      roomCode = currentRandomRoom;
    } else {
      roomCode = code.toUpperCase();
      if (!rooms[roomCode]) rooms[roomCode] = { players: {}, playerOrder: [], queue: [], gameStarted: false, timer: startingTimer };
    }

    socket.join(roomCode);
    rooms[roomCode].players[socket.id] = { name, lives: 3, ready: false, startPressed: false };
    socket.roomCode = roomCode;

    io.to(socket.id).emit("lobbyInfo", { roomCode });
    io.emit("leaderboardUpdate", leaderboard);
  });

  // --- First ready: join queue ---
  socket.on("playerReady", () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;

    if (!room.queue) room.queue = [];
    if (!room.queue.includes(socket.id)) room.queue.push(socket.id);

    io.to(socket.roomCode).emit("updateQueue", room.players, room.queue);
  });

  // --- Second ready in queue: mark ready to start ---
  socket.on("startPressed", () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;

    room.players[socket.id].startPressed = true;
    io.to(socket.roomCode).emit("updateQueue", room.players, room.queue);

    // --- Start game if everyone in queue pressed Ready the second time ---
    const allReady = room.queue.length >= 2 && room.queue.every(id => room.players[id].startPressed);
    if (!room.gameStarted && allReady) {

      // --- Generate a new random room code for the next game ---
      if (currentRandomRoom === room.socket?.roomCode || currentRandomRoom === socket.roomCode) {
        currentRandomRoom = generateRoomCode();
        rooms[currentRandomRoom] = { players: {}, playerOrder: [], queue: [], gameStarted: false, timer: startingTimer };
      }

      room.gameStarted = true;
      room.playerOrder = [...room.queue];
      room.queue = [];
      room.currentPlayerIndex = -1;
      room.timer = startingTimer;
      Object.values(room.players).forEach(p => { p.ready = false; p.startPressed = false; });

      nextTurn(socket.roomCode);
    }
  });

  socket.on("submitWord", (word) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;
    const activeId = room.playerOrder[room.currentPlayerIndex];
    if (socket.id !== activeId) return;

    const player = room.players[socket.id];
    const submittedWord = word.toUpperCase();

    const tooShort = submittedWord.length < 3;
    const missingCombo = !submittedWord.includes(room.currentPrompt);
    const notEnglish = !englishWords.has(submittedWord);

    if (tooShort || missingCombo || notEnglish) {
      player.lives--;

      socket.emit("lifeLost", {
        reason: notEnglish ? "Not a valid English word" :
                missingCombo ? `Must include: ${room.currentPrompt}` :
                "Too short",
        lives: player.lives
      });

      if (player.lives <= 0) {
        delete room.players[socket.id];
        room.playerOrder = room.playerOrder.filter(id => id !== socket.id);
      }
    } else {
      if (!leaderboard[player.name]) leaderboard[player.name] = { longestWord: 0, longestWordText: "", wins: 0 };
      if (submittedWord.length > leaderboard[player.name].longestWord) {
        leaderboard[player.name].longestWord = submittedWord.length;
        leaderboard[player.name].longestWordText = submittedWord;
      }

      // --- Dynamic timer shortening ---
      const aliveCount = Object.values(room.players).filter(p => p.lives > 0).length;
      room.timer = Math.max(minTimer, room.timer - 1 / aliveCount);
    }

    fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboard, null, 2));

    io.to(socket.roomCode).emit("updatePlayers", room.players);
    io.emit("leaderboardUpdate", leaderboard);

    checkWinner(socket.roomCode);
    nextTurn(socket.roomCode);
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    delete room.players[socket.id];
    room.playerOrder = room.playerOrder.filter(id => id !== socket.id);
    room.queue = room.queue.filter(id => id !== socket.id);
    io.to(socket.roomCode).emit("updateQueue", room.players, room.queue);
  });
});

http.listen(3000, () => console.log("Server running on port 3000"));
