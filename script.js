const socket = io();

/* ---------- DOM ---------- */
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

const lobby = document.getElementById("lobby");
const gameArea = document.getElementById("gameArea");
const leaderboardDiv = document.getElementById("leaderboard");

/* ---------- STATE ---------- */
let myId = "";
let activePlayerId = "";

/* ---------- SOCKET ---------- */
socket.on("connect", () => { myId = socket.id; });

/* ---------- JOIN ---------- */
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

/* ---------- READY ---------- */
readyBtn.onclick = () => { socket.emit("playerReady"); };

/* ---------- SUBMIT WORD ---------- */
submitWordBtn.onclick = submitWord;
wordInput.addEventListener("keydown", e => { if(e.key==="Enter") submitWord(); });

function submitWord() {
  if (myId !== activePlayerId) { alert("Not your turn!"); return; }
  const word = wordInput.value.trim();
  if (!word) return;
  socket.emit("submitWord", word);
  wordInput.value = "";
}

/* ---------- SOCKET EVENTS ---------- */
socket.on("lobbyInfo", ({ roomCode }) => { roomDisplay.textContent = `Room: ${roomCode}`; });

socket.on("updatePlayers", players => {
  playersList.innerHTML = "";
  for (const id in players) {
    const p = players[id];
    const li = document.createElement("li");
    li.textContent = `${p.name} - Lives: ${p.lives}`;
    if (id === activePlayerId) li.classList.add("active");
    if (p.lives <= 0) li.classList.add("eliminated");
    playersList.appendChild(li);
  }
});

socket.on("newPrompt", ({ prompt, timer, activePlayer }) => {
  lobby.style.display = "none";
  gameArea.style.display = "block";
  activePlayerId = activePlayer;
  promptDisplay.textContent = prompt;
  timeDisplay.textContent = timer;
  const isMyTurn = myId === activePlayer;
  wordInput.disabled = !isMyTurn;
  submitWordBtn.disabled = !isMyTurn;
});

socket.on("timer", time => { timeDisplay.textContent = time; });
socket.on("lifeLost", ({ reason, lives }) => { alert(`❌ ${reason}\n❤️ Lives left: ${lives}`); });

socket.on("gameOver", ({ winner, leaderboard }) => {
  alert(`🏆 ${winner} wins!`);
  lobby.style.display = "block"; 
  gameArea.style.display = "none";
  renderLeaderboard(leaderboard);

  // NOTE for players after game
  leaderboardDiv.innerHTML += `<p style="margin-top:10px; color:#333; font-weight:bold;">
    Press "Join Random Game" or enter a code, then click Ready to play again!
  </p>`;
});

socket.on("message", msg => { alert(msg); });

/* ---------- LEADERBOARDS ---------- */
socket.on("leaderboardUpdate", board => { renderLeaderboard(board); });

function renderLeaderboard(lb) {
  // Only show Wins and Longest Words; star words leaderboard hidden
  leaderboardDiv.innerHTML = `
    <h3>🏆 Wins</h3>
    ${top5(lb,"wins")}
    <h3>📏 Longest Words</h3>
    ${top5(lb,"longestLen",true)}
  `;
}

function top5(lb,key,showWord=false) {
  return Object.entries(lb)
    .sort((a,b)=> (b[1][key]||0)-(a[1][key]||0))
    .slice(0,5)
    .map(([name,p])=> showWord? `<p>${name}: "${p.longestWord}" (${p.longestLen})</p>` : `<p>${name}: ${p[key]||0}</p>`)
    .join("");
}
