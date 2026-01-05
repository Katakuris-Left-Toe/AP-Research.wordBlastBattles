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

// Load or create leaderboard
let leaderboard = {};
const leaderboardPath = path.join(__dirname, "leaderboard.json");
if (fs.existsSync(leaderboardPath)) {
  leaderboard = JSON.parse(fs.readFileSync(leaderboardPath, "utf8"));
} else {
  fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboard, null, 2));
}

// Game settings
const minTimer = 5;
const startingTimer = 15;
const timerDecrease = 1;
const combos = ["BA","CA","DA","MA","PA","RA","TA","BE","BI","BO","BU","LA","LE","LI","LO","AN","IN","ON","UN"];

const rooms = {}; // roomCode -> { players, playerOrder, currentPlayerIndex, gameStarted, timer, timerInterval, currentPrompt }

// ---------- HELPERS ----------
function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Start next turn
function nextTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted || room.playerOrder.length === 0) return;

  let count = 0;
  do {
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.playerOrder.length;
    count++;
  } while (!room.players[room.playerOrder[room.currentPlayerIndex]]?.lives && count <= room.playerOrder.length);

  room.timer = Math.max(minTimer, room.timer - timerDecrease);
  startPrompt(roomCode);
}

// Start prompt for active player
function startPrompt(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted || room.playerOrder.length === 0) return;

  room.currentPrompt = combos[Math.floor(Math.random() * combos.length)];
  const activeId = room.playerOrder[room.currentPlayerIndex];

  io.to(roomCode).emit("newPrompt", {
    prompt: room.currentPrompt,
    timer: room.timer,
    activePlayer: activeId
  });

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

// Check if only one player remains
function checkWinner(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const remaining = Object.values(room.players).filter(p => p.lives > 0);
  if (remaining.length === 1) {
    const winner = remaining[0];
    if (!leaderboard[winner.name]) leaderboard[winner.name] = { longestLen: 0, longestWord: "", wins: 0 };
    leaderboard[winner.name].wins += 1;
    fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboard, null, 2));

    io.to(roomCode).emit("gameOver", { winner: winner.name, leaderboard });
    room.gameStarted = false;
    clearInterval(room.timerInterval);
  }
}

// ---------- SOCKET.IO ----------
io.on("connection", (socket) => {
  console.log("User connected", socket.id);

  socket.on("joinRoom", ({ name, code, random }) => {
    let roomCode;
    if (random) {
      roomCode = Object.keys(rooms).find(rc => !rooms[rc].gameStarted && rooms[rc].playerOrder.length < 7 && rooms[rc].playerOrder.length > 0);
      if (!roomCode) {
        roomCode = generateRoomCode();
        rooms[roomCode] = { players: {}, playerOrder: [], currentPlayerIndex: 0, gameStarted: false, timer: startingTimer };
      }
    } else {
      roomCode = code.toUpperCase();
      if (!rooms[roomCode]) rooms[roomCode] = { players: {}, playerOrder: [], currentPlayerIndex: 0, gameStarted: false, timer: startingTimer };
    }

    if (rooms[roomCode].playerOrder.length >= 7) {
      socket.emit("roomFull");
      return;
    }

    socket.join(roomCode);
    rooms[roomCode].players[socket.id] = { name, lives: 3, ready: false };
    rooms[roomCode].playerOrder.push(socket.id);
    socket.roomCode = roomCode;

    io.to(roomCode).emit("updatePlayers", rooms[roomCode].players);
    io.to(roomCode).emit("lobbyInfo", { roomCode });
    io.emit("leaderboardUpdate", leaderboard);
  });

  socket.on("playerReady", () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].ready = true;

    // Minimum 2 players to start
    const alivePlayers = Object.values(room.players).filter(p => p.lives > 0);
    if (alivePlayers.length >= 2 && Object.values(room.players).every(p => p.ready) && !room.gameStarted) {
      room.gameStarted = true;
      room.currentPlayerIndex = 0;
      room.timer = startingTimer;
      startPrompt(socket.roomCode);
    }

    io.to(socket.roomCode).emit("updatePlayers", room.players);
  });

  socket.on("submitWord", (word) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;
    const activeId = room.playerOrder[room.currentPlayerIndex];
    if (socket.id !== activeId) return;

    const player = room.players[socket.id];
    const submittedWord = word.toUpperCase();
    let reason = "";

    if (submittedWord.length < 3) reason = "Too short";
    else if (!submittedWord.includes(room.currentPrompt)) reason = "Does not include prompt";
    else if (!englishWords.has(submittedWord)) reason = "Not a valid English word";

    if (reason) {
      player.lives--;
      socket.emit("lifeLost", { reason, lives: player.lives });
      if (player.lives <= 0) {
        delete room.players[socket.id];
        room.playerOrder = room.playerOrder.filter(id => id !== socket.id);
      }
    } else {
      if (!leaderboard[player.name]) leaderboard[player.name] = { longestLen: 0, longestWord: "", wins: 0 };
      if (submittedWord.length > leaderboard[player.name].longestLen) {
        leaderboard[player.name].longestLen = submittedWord.length;
        leaderboard[player.name].longestWord = submittedWord;
      }
    }

    fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboard, null, 2));

    io.to(socket.roomCode).emit("updatePlayers", room.players);
    io.emit("leaderboardUpdate", leaderboard);

    checkWinner(socket.roomCode);
    nextTurn(socket.roomCode); // ✅ fixed reference
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    delete room.players[socket.id];
    room.playerOrder = room.playerOrder.filter(id => id !== socket.id);
    io.to(socket.roomCode).emit("updatePlayers", room.players);
  });
});

http.listen(3000, () => console.log("Server running on port 3000"));
