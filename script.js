import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';

///////////////////
// Utility Functions
///////////////////
function vectorEquals(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function cloneVector(v) {
  return { x: v.x, y: v.y, z: v.z };
}

function addVectors(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function inBounds(pos, gridSize) {
  return (
    pos.x >= 0 &&
    pos.x < gridSize &&
    pos.y >= 0 &&
    pos.y < gridSize &&
    pos.z >= 0 &&
    pos.z < gridSize
  );
}

///////////////////
// Game Class
///////////////////
class Game {
  constructor(scene, agent) {
    this.scene = scene;
    this.agent = agent;
    this.gridSize = 10; // A 10x10x10 grid
    this.score = 0;
    this.episode = 0;
    this.initRendering();
    this.reset();
  }

  reset() {
    // Clear previous game objects from scene if any
    if (this.snakeGroup) {
      this.scene.remove(this.snakeGroup);
    }
    // NOTE: Removed removal of appleMesh to ensure a single food remains in the map.
    // if (this.appleMesh) {
    //   this.scene.remove(this.appleMesh);
    // }
    
    // Initialize snake in center with length 3 moving in +x direction.
    const center = Math.floor(this.gridSize / 2);
    this.snake = [
      { x: center - 2, y: center, z: center },
      { x: center - 1, y: center, z: center },
      { x: center, y: center, z: center }
    ];
    this.direction = { x: 1, y: 0, z: 0 };
    this.placeApple();
    this.updateState();
    this.done = false;
    this.reward = 0;
    // Used for Q-learning update: store previous state and action.
    this.prevState = null;
    this.prevAction = null;
    // Reset score for simulation (if needed)
    this.score = 0;
  }

  updateState() {
    this.state = this.getState();
  }

  // Place apple in a random location not occupied by the snake.
  placeApple() {
    let pos;
    // To ensure apple always spawns on a free cell, we loop until we find one.
    do {
      pos = {
        x: Math.floor(Math.random() * this.gridSize),
        y: Math.floor(Math.random() * this.gridSize),
        z: Math.floor(Math.random() * this.gridSize)
      };
    } while (this.snake.some(seg => vectorEquals(seg, pos)));
    this.apple = pos;
  }

  step() {
    // Check if previous move resulted in a terminal state.
    if (this.done) {
      this.episode++;
      const episodeElem = document.getElementById("episode");
      if (episodeElem) episodeElem.innerText = this.episode;
      // Decay exploration rate only at end of an episode.
      this.agent.epsilon = Math.max(this.agent.epsilon * this.agent.epsilonDecay, this.agent.epsilonMin);
      this.reset();
      return;
    }

    // Get current state
    const currentState = this.getState();
    // Determine allowed actions based on current direction.
    const allowedActions = Agent.allowedActions(this.direction);

    // Choose action from agent (action is index corresponding to direction)
    const action = this.agent.chooseAction(currentState, allowedActions);
    // Save state and action for Q-learning update later.
    this.prevState = currentState;
    this.prevAction = action;

    // Set new direction based on chosen action
    const newDir = Agent.directions[action];
    // Prevent going backward
    if (
      this.direction.x + newDir.x === 0 &&
      this.direction.y + newDir.y === 0 &&
      this.direction.z + newDir.z === 0
    ) {
      // If reverse, ignore action and keep current direction.
    } else {
      this.direction = newDir;
    }

    // Calculate new head position
    const head = this.snake[this.snake.length - 1];
    const newHead = addVectors(head, this.direction);

    // Check collisions with wall or self
    if (!inBounds(newHead, this.gridSize)) {
      // Wall collision: reward -2.
      this.reward = -2;
      this.agent.updateQ(this.prevState, this.prevAction, this.reward, "terminal");
      this.done = true;
      return;
    } else if (this.snake.some(seg => vectorEquals(seg, newHead))) {
      // Self collision: reward -1.
      this.reward = -1;
      this.agent.updateQ(this.prevState, this.prevAction, this.reward, "terminal");
      this.done = true;
      return;
    }

    // Move snake: Add new head
    this.snake.push(newHead);
    // Check if apple is eaten
    let ateApple = vectorEquals(newHead, this.apple);
    if (ateApple) {
      this.reward = 1;
      this.score++;
      const scoreElem = document.getElementById("score");
      if (scoreElem) scoreElem.innerText = this.score;
      // Place new apple ensuring it does not spawn on top of the snake.
      this.placeApple();
    } else {
      // Remove tail segment to maintain length
      this.snake.shift();
      this.reward = 0;
    }

    // Get next state after moving
    const nextState = this.getState();
    // Update Q-value using agent's update rule
    this.agent.updateQ(this.prevState, this.prevAction, this.reward, nextState);
    this.updateState();
    this.updateRendering();
  }

  getState() {
    // The state consists of:
    //   Danger in all 6 directions (1 if danger, 0 otherwise)
    //   Food direction relative to snake head for x, y, z as: "1" if apple is in positive direction, "-1" if negative, "0" if equal.
    const head = this.snake[this.snake.length - 1];
    let danger = Agent.directions.map(dir => {
      const nextPos = addVectors(head, dir);
      return (!inBounds(nextPos, this.gridSize) || this.snake.some(seg => vectorEquals(seg, nextPos))) ? 1 : 0;
    });
    const foodDir = ['x','y','z'].map(axis => {
      if (this.apple[axis] > head[axis]) return "1";
      else if (this.apple[axis] < head[axis]) return "-1";
      else return "0";
    });
    return danger.join('') + '|' + foodDir.join('');
  }

  ///////////////////
  // Three.js Rendering methods
  ///////////////////
  initRendering() {
    // Group for snake segments
    this.snakeGroup = new THREE.Group();
    this.scene.add(this.snakeGroup);
    // Create apple mesh
    const appleGeometry = new THREE.SphereGeometry(0.4, 16, 16);
    const appleMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
    this.appleMesh = new THREE.Mesh(appleGeometry, appleMaterial);
    this.scene.add(this.appleMesh);
  }

  updateRendering() {
    // Update snake rendering:
    // Remove old snake group and re-create it.
    this.scene.remove(this.snakeGroup);
    this.snakeGroup = new THREE.Group();
    const boxGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const boxMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
    this.snake.forEach(seg => {
      const cube = new THREE.Mesh(boxGeometry, boxMaterial);
      cube.position.set(seg.x - this.gridSize / 2 + 0.5, seg.y - this.gridSize / 2 + 0.5, seg.z - this.gridSize / 2 + 0.5);
      this.snakeGroup.add(cube);
    });
    this.scene.add(this.snakeGroup);

    // Update apple mesh position to the current apple coordinates.
    this.appleMesh.position.set(
      this.apple.x - this.gridSize / 2 + 0.5,
      this.apple.y - this.gridSize / 2 + 0.5,
      this.apple.z - this.gridSize / 2 + 0.5
    );
  }
}

///////////////////
// Agent Class (Q-Learning)
///////////////////
class Agent {
  constructor() {
    // Q-table: mapping from state (string) to array of Q-values for each of 6 directions.
    this.Q = {};
    // Learning parameters
    this.lr = 0.1;         // learning rate
    this.discount = 0.9;   // discount factor
    this.epsilon = 1.0;    // exploration rate
    this.epsilonMin = 0.01;
    this.epsilonDecay = 0.995;
  }

  static get directions() {
    // Order: 0: +x, 1: -x, 2: +y, 3: -y, 4: +z, 5: -z.
    return [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 }
    ];
  }

  static allowedActions(currentDir) {
    // All indices except the one that is the inverse of currentDir.
    let allowed = [];
    Agent.directions.forEach((dir, index) => {
      if (currentDir.x + dir.x === 0 && currentDir.y + dir.y === 0 && currentDir.z + dir.z === 0) {
        // This is the opposite direction; disallow.
      } else {
        allowed.push(index);
      }
    });
    return allowed;
  }

  getQ(state) {
    if (!(state in this.Q)) {
      // Initialize Q-values for all 6 actions.
      this.Q[state] = [0, 0, 0, 0, 0, 0];
    }
    return this.Q[state];
  }

  chooseAction(state, allowedActions) {
    // Epsilon-greedy policy
    if (Math.random() < this.epsilon) {
      // Explore: choose a random allowed action
      return allowedActions[Math.floor(Math.random() * allowedActions.length)];
    }
    // Exploit: choose the best Q value among allowed actions
    const qValues = this.getQ(state);
    let bestAction = allowedActions[0];
    let bestValue = qValues[bestAction];
    allowedActions.forEach(a => {
      if (qValues[a] > bestValue) {
        bestValue = qValues[a];
        bestAction = a;
      }
    });
    return bestAction;
  }

  updateQ(state, action, reward, nextState) {
    // Get current Q state, initialize if needed
    const qValues = this.getQ(state);
    const currentQ = qValues[action];
    let qNext = 0;
    if (nextState !== "terminal") {
      const nextQValues = this.getQ(nextState);
      qNext = Math.max(...nextQValues);
    }
    // Q-learning update rule
    const newQ = currentQ + this.lr * (reward + this.discount * qNext - currentQ);
    this.Q[state][action] = newQ;
    // Note: Epsilon decay now happens at the end of an episode in Game.step.
  }

  // Export Q-table as a JSON string
  exportWeights() {
    return JSON.stringify(this.Q);
  }

  // Import weights from a JSON string
  importWeights(jsonStr) {
    try {
      const importedQ = JSON.parse(jsonStr);
      this.Q = importedQ;
      return true;
    } catch (err) {
      console.error("Error importing weights:", err);
      return false;
    }
  }
}

///////////////////
// Three.js Setup
///////////////////
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

// Camera setup
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(15, 15, 15);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
directionalLight.position.set(10, 10, 5);
scene.add(directionalLight);

// Optional: Add a grid helper to visualize the board boundaries in 3D
const gridHelper = new THREE.BoxHelper(new THREE.Mesh(new THREE.BoxGeometry(10,10,10)), 0xffff00);
scene.add(gridHelper);

///////////////////
// Instantiate Agent and Game
///////////////////
const agent = new Agent();
const game = new Game(scene, agent);

// Game loop parameters with adjustable moveInterval
let moveInterval = 200; // default ms per game step
let lastTime = 0;

function animate(time) {
  requestAnimationFrame(animate);
  if (time - lastTime > moveInterval) {
    game.step();
    lastTime = time;
  }
  renderer.render(scene, camera);
}
animate(0);

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

///////////////////
// Weight Export/Import Handlers
///////////////////
document.getElementById("downloadWeights").addEventListener("click", () => {
  const data = agent.exportWeights();
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "weights.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

document.getElementById("importWeights").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const success = agent.importWeights(e.target.result);
    if (success) {
      alert("Weights imported successfully!");
    } else {
      alert("Failed to import weights.");
    }
  };
  reader.readAsText(file);
});

// Speed Toggle Handler
const speedToggle = document.getElementById("speedToggle");
const speedValue = document.getElementById("speedValue");
speedToggle.addEventListener("input", (e) => {
  moveInterval = parseInt(e.target.value);
  speedValue.innerText = e.target.value;
});

///////////////////
// Multiplayer Lobby Setup
///////////////////
// Assume WebsimSocket is available globally.
const room = new WebsimSocket();

room.onmessage = (event) => {
  const data = event.data;
  switch(data.type) {
    case "challengeRequest":
      // Only process challenges directed to this client.
      if(data.targetId === room.party.client.id) {
        showChallengeModal(data);
      }
      break;
    case "challengeAccepted":
      // If you initiated the challenge and the defender accepted.
      if(data.challengerId === room.party.client.id) {
        startBattleSimulation(agent.exportWeights(), data.defenderWeights, data.defenderUsername);
      }
      break;
    default:
      console.log("Received event:", data);
  }
};

function updateLobbyList() {
  const lobbyList = document.getElementById("lobbyList");
  lobbyList.innerHTML = '';
  for (const clientId in room.party.peers) {
    if(clientId === room.party.client.id) continue;
    const { avatarUrl, username } = room.party.peers[clientId];
    const li = document.createElement("li");
    li.innerHTML = `<img src="https://images.websim.ai/avatar/${username}" alt="${username}" width="30" height="30"> ${username} <button data-clientid="${clientId}">Challenge</button>`;
    li.querySelector("button").addEventListener("click", () => {
       sendChallenge(clientId, username);
    });
    lobbyList.appendChild(li);
  }
}

room.party.subscribe(updateLobbyList);

function sendChallenge(targetId, targetUsername) {
  room.send({
    type: "challengeRequest",
    targetId: targetId,
    challengerId: room.party.client.id,
    challengerWeights: agent.exportWeights(),
    challengerUsername: room.party.client.username
  });
  alert(`Challenge sent to ${targetUsername}`);
}

function showChallengeModal(challengeData) {
  const modal = document.getElementById("challengeModal");
  const modalContent = modal.querySelector(".modal-content");
  modalContent.innerHTML = `<p>${challengeData.challengerUsername} has challenged you!</p>
    <button id="acceptChallenge">Accept</button>
    <button id="declineChallenge">Decline</button>`;
  modal.style.display = "block";
  document.getElementById("acceptChallenge").addEventListener("click", () => {
    room.send({
      type: "challengeAccepted",
      challengerId: challengeData.challengerId,
      defenderWeights: agent.exportWeights(),
      defenderUsername: room.party.client.username,
      targetId: challengeData.challengerId
    });
    // Start battle simulation as defender.
    startBattleSimulation(challengeData.challengerWeights, agent.exportWeights(), challengeData.challengerUsername);
    modal.style.display = "none";
  });
  document.getElementById("declineChallenge").addEventListener("click", () => {
    modal.style.display = "none";
  });
}

function startBattleSimulation(challengerWeights, defenderWeights, opponentUsername) {
  // Simulate performance for both agents over a number of episodes using a headless game.
  const dummyScene = new THREE.Scene();
  const episodes = 10;
  function simulatePerformance(weights, callback) {
    const testAgent = new Agent();
    testAgent.importWeights(weights);
    const testGame = new Game(dummyScene, testAgent);
    let totalScore = 0;
    let episodesCompleted = 0;
    
    function runEpisode() {
      testGame.reset();
      let steps = 0;
      while(!testGame.done && steps < 1000) {
        testGame.step();
        steps++;
      }
      totalScore += testGame.score;
      episodesCompleted++;
      if(episodesCompleted < episodes) {
        runEpisode();
      } else {
        callback(totalScore / episodes);
      }
    }
    runEpisode();
  }
  
  // Display battle simulation modal.
  const battleModal = document.getElementById("battleModal");
  battleModal.style.display = "block";
  battleModal.innerHTML = `<div class="modal-content" id="battleModalContent">
    <p>Battle Simulation in progress...</p>
  </div>`;
  
  simulatePerformance(challengerWeights, (challengerAvg) => {
    simulatePerformance(defenderWeights, (defenderAvg) => {
      let resultText = "";
      if(challengerAvg > defenderAvg) {
         resultText = `${opponentUsername} wins! (Avg Score: ${challengerAvg.toFixed(2)} vs ${defenderAvg.toFixed(2)})`;
      } else if(challengerAvg < defenderAvg) {
         resultText = `You win! (Avg Score: ${defenderAvg.toFixed(2)} vs ${challengerAvg.toFixed(2)})`;
      } else {
         resultText = `It's a tie! (Avg Score: ${challengerAvg.toFixed(2)})`;
      }
      battleModal.innerHTML = `<div class="modal-content" id="battleModalContent">
         <p>Battle Result:</p>
         <p>${resultText}</p>
         <button id="closeBattleModal">Close</button>
      </div>`;
      document.getElementById("closeBattleModal").addEventListener("click", () => {
         battleModal.style.display = "none";
      });
    });
  });
}

// Multiplayer Lobby Modal toggling
document.getElementById("showLobbyButton").addEventListener("click", () => {
  const lobbyModal = document.getElementById("lobbyModal");
  lobbyModal.style.display = "block";
});

document.getElementById("closeLobbyModal").addEventListener("click", () => {
  const lobbyModal = document.getElementById("lobbyModal");
  lobbyModal.style.display = "none";
});