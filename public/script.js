const socket = io();

const joinBtn = document.getElementById("joinBtn");
const randomBtn = document.getElementById("randomBtn");
const readyBtn = document.getElementById("readyBtn");
const submitWordBtn = document.getElementById("submitWordBtn");

const nameInput = document.getElementById("nameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const wordInput = document.getElementById("wordInput");

const playersList = document.getElementById("playersList");
const promptDisplay = document.getElementById("prompt");
const timeDisplay = document.getElementById("timeLeft");
const roomDisplay = document.getElementById("roomDisplay");

const gameContainer = document.getElementById("gameContainer");
const lobby = document.getElementById("lobby");
const leaderboardDiv = document.getElementById("leaderboard");

// Waiting screen
const waitingScreen = document.createElement("div");
waitingScreen.id = "waitingScreen";
waitingScreen.style.display = "none";
waitingScreen.style.textAlign = "center";
waitingScreen.style.marginTop = "50px";
waitingScreen.innerHTML = `
  <h2>Lobby - Waiting to Start</h2>
  <div id="queueRoomCode" style="font-weight:bold; margin-bottom:10px;"></div>
  <ul id="waitingPlayersList"></ul>
`;
document.body.appendChild(waitingScreen);

let myId = "";
let activePlayerId = "";
let myRoomCode = "";

socket.on("connect", () => { myId = socket.id; });

// Join room
joinBtn.onclick = () => {
  const name = nameInput.value.trim();
  const code = roomCodeInput.value.trim();
  if (!name) return alert("Enter your name");
  socket.emit("joinRoom", { name, code, random: false });
};

randomBtn.onclick = () => {
  const name = nameInput.value.trim();
  if (!name) return alert("Enter your name");
  socket.emit("joinRoom", { name, random: true });
};

// Ready → enter queue
readyBtn.onclick = () => {
  lobby.style.display = "none";
  waitingScreen.style.display = "block";
  socket.emit("playerReady");
};

// Submit guess
submitWordBtn.onclick = submitWord;
wordInput.addEventListener("keydown", e => { if(e.key==="Enter") submitWord(); });
function submitWord() {
  if (myId !== activePlayerId) { alert("Not your turn!"); return; }
  const word = wordInput.value.trim();
  if (!word) return;
  socket.emit("submitWord", word);
  wordInput.value = "";
}

// Lobby info → show room code
socket.on("lobbyInfo", ({ roomCode }) => {
  roomDisplay.textContent = `Room Code: ${roomCode}`;
  myRoomCode = roomCode;
  document.getElementById("queueRoomCode").textContent = `Room Code: ${myRoomCode}`;
});

// Update queue display
socket.on("updateQueue", (players, queue) => {
  const list = document.getElementById("waitingPlayersList");
  list.innerHTML = "";
  queue.forEach(id => {
    const p = players[id];
    const li = document.createElement("li");
    li.textContent = p.name + (p.startPressed ? " ✅" : "");
    list.appendChild(li);
  });

  // Show start game button for 2+ players
  if (queue.length > 1) {
    if (!document.getElementById("startGameBtn")) {
      const btn = document.createElement("button");
      btn.id = "startGameBtn";
      btn.textContent = "Start Game";
      btn.style.marginTop = "20px";
      btn.onclick = () => { socket.emit("startPressed"); btn.disabled = true; };
      waitingScreen.appendChild(btn);
    }
  } else {
    const existing = document.getElementById("startGameBtn");
    if (existing) existing.remove();
  }
});

// Game starts
socket.on("newPrompt", ({ prompt, timer, activePlayer }) => {
  waitingScreen.style.display = "none";
  gameContainer.style.display = "flex";

  activePlayerId = activePlayer;
  promptDisplay.textContent = prompt;
  timeDisplay.textContent = timer;

  const isMyTurn = myId === activePlayer;
  wordInput.disabled = !isMyTurn;
  submitWordBtn.disabled = !isMyTurn;
});

// Timer & lifeLost
socket.on("timer", time => { timeDisplay.textContent = time; });
socket.on("lifeLost", ({ reason, lives }) => { alert(`${reason}. Lives left: ${lives}`); });

// Game over
socket.on("gameOver", ({ winner, leaderboard }) => {
  alert(`${winner} wins!`);
  lobby.style.display = "block";
  gameContainer.style.display = "none";
  renderLeaderboard(leaderboard);
});

// Leaderboard
socket.on("leaderboardUpdate", board => { renderLeaderboard(board); });
function renderLeaderboard(lb) {
  leaderboardDiv.innerHTML = `
    <h3>Wins</h3>
    ${top5(lb,"wins")}
    <h3>Longest Words</h3>
    ${top5(lb,"longestWord",true)}
  `;
}
function top5(lb,key,showWord=false) {
  return Object.entries(lb)
    .sort((a,b)=> (b[1][key]||0)-(a[1][key]||0))
    .slice(0,5)
    .map(([name,p]) => showWord ? `<p>${name}: "${p.longestWordText}" (${p.longestWord})</p>` : `<p>${name}: ${p[key]||0}</p>`)
    .join("");
}
