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

let myId = "";
let activePlayerId = "";

socket.on("connect", () => { myId = socket.id; });

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

readyBtn.onclick = () => { socket.emit("playerReady"); };

submitWordBtn.onclick = submitWord;
wordInput.addEventListener("keydown", e => { if(e.key==="Enter") submitWord(); });

function submitWord() {
  if (myId !== activePlayerId) { alert("Not your turn!"); return; }
  const word = wordInput.value.trim();
  if (!word) return;
  socket.emit("submitWord", word);
  wordInput.value = "";
}

socket.on("lobbyInfo", ({ roomCode }) => { roomDisplay.textContent = `Room: ${roomCode}`; });

socket.on("updatePlayers", players => {
  playersList.innerHTML = "";
  for (const id in players) {
    const p = players[id];
    const li = document.createElement("li");
    li.textContent = `${p.name} - Lives: ${p.lives}`;
    li.className = "";
    if (id === activePlayerId) li.classList.add("active");
    if (p.lives <= 0) li.classList.add("eliminated");
    playersList.appendChild(li);
  }
});

socket.on("newPrompt", ({ prompt, timer, activePlayer }) => {
  lobby.style.display = "none";
  gameContainer.style.display = "flex";

  activePlayerId = activePlayer;
  promptDisplay.textContent = prompt;
  timeDisplay.textContent = timer;

  const isMyTurn = myId === activePlayer;
  wordInput.disabled = !isMyTurn;
  submitWordBtn.disabled = !isMyTurn;
});

socket.on("timer", time => { timeDisplay.textContent = time; });

socket.on("lifeLost", ({ reason, lives }) => { alert(`${reason}. Lives left: ${lives}`); });

socket.on("gameOver", ({ winner, leaderboard }) => {
  alert(`${winner} wins!`);
  lobby.style.display = "block";
  gameContainer.style.display = "none";
  renderLeaderboard(leaderboard);
});

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
