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
const combos = [
  // Original simple clusters
  "BA","CA","DA","MA","PA","RA","TA","BE","BI","BO","BU","LA","LE","LI","LO","AN","IN","ON","UN","BL","CL","FL","GL","PL","SL","BR","CR","DR","FR","GR","PR","TR","SC","SK","SL","SM","SN","SP","ST","SW","WH","WR"];

const rooms = {}; // roomCode -> { players, playerOrder, currentPlayerIndex, gameStarted, timer, timerInterval, currentPrompt, activePlayerId }

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

  // Increment current player index
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.playerOrder.length;
  const activeId = room.playerOrder[room.currentPlayerIndex];
  room.activePlayerId = activeId;

  startPrompt(roomCode);
}

// Start prompt for active player
function startPrompt(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted || room.playerOrder.length === 0) return;

  room.currentPrompt = combos[Math.floor(Math.random() * combos.length)];
  const activeId = room.playerOrder[room.currentPlayerIndex];
  room.activePlayerId = activeId;

  // Emit prompt and timer
  io.to(roomCode).emit("newPrompt", {
    prompt: room.currentPrompt,
    timer: room.timer,
    activePlayer: activeId
  });

  // Update player list highlighting
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

// Check winner
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
    room.gameStarted = false;
    clearInterval(room.timerInterval);

    // Reset all players' ready status for next game
    Object.values(room.players).forEach(p => p.ready = false);
    room.currentPlayerIndex = -1;
  }
}

io.on("connection", (socket) => {
  console.log("User connected", socket.id);

  socket.on("joinRoom", ({ name, code, random }) => {
    let roomCode;
    if (random) {
      roomCode = Object.keys(rooms).find(rc => !rooms[rc].gameStarted && rooms[rc].playerOrder.length < 7 && rooms[rc].playerOrder.length > 0);
      if (!roomCode) {
        roomCode = generateRoomCode();
        rooms[roomCode] = { players: {}, playerOrder: [], currentPlayerIndex: -1, gameStarted: false, timer: startingTimer };
      }
    } else {
      roomCode = code.toUpperCase();
      if (!rooms[roomCode]) rooms[roomCode] = { players: {}, playerOrder: [], currentPlayerIndex: -1, gameStarted: false, timer: startingTimer };
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

    const readyCount = Object.values(room.players).filter(p => p.ready).length;

    // Start game if minimum 2 players ready
    if (!room.gameStarted && readyCount >= 2 && Object.values(room.players).every(p => p.ready)) {
      room.gameStarted = true;
      room.currentPlayerIndex = -1;
      room.timer = startingTimer;

      // Reset ready status
      Object.values(room.players).forEach(p => p.ready = false);

      // Start first turn
      nextTurn(socket.roomCode);
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

    if (submittedWord.length < 3 || !submittedWord.includes(room.currentPrompt) || !englishWords.has(submittedWord)) {
      player.lives--;
      socket.emit("lifeLost", {
        reason: !englishWords.has(submittedWord) ? "Not a valid English word" :
                !submittedWord.includes(room.currentPrompt) ? "Does not include the prompt" :
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
    io.to(socket.roomCode).emit("updatePlayers", room.players);
  });
});

http.listen(3000, () => console.log("Server running on port 3000"));
