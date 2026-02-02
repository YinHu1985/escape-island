import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Heart, Zap, Shield, Map as MapIcon, RotateCcw, Crosshair } from 'lucide-react';

/**
 * ==========================================
 * CONSTANTS & CONFIGURATION
 * ==========================================
 */
const TILE_SIZE = 48; // Size of grid tiles in pixels
const ROOM_WIDTH = 15; // Tiles per room width
const ROOM_HEIGHT = 11; // Tiles per room height
const FPS = 60;

// Game Colors (Placeholders for assets)
const COLORS = {
  background: '#2c3e50',
  wall: '#34495e',
  floor: '#95a5a6',
  door: '#e67e22',
  bossDoor: '#e74c3c', // Red door for the exit
  furniture: '#7f8c8d',
  player: '#2ecc71',
  enemy: '#c0392b',
  projectile: '#f1c40f', // Cookie color
  pizza: '#f39c12',
  pizzaBox: '#d35400',
  uiBg: 'rgba(0,0,0,0.7)',
  // Minimap Colors
  minimapBg: 'rgba(0, 0, 0, 0.6)',
  minimapRoom: '#444',
  minimapExplored: '#3498db',
  minimapActive: '#ecf0f1',
  minimapItem: '#f1c40f',
  minimapBoss: '#e74c3c'
};

// Character Presets
const CHARACTERS = [
  {
    id: 'runner',
    name: 'Swift Scout',
    description: 'Fast movement, lower health.',
    speed: 5,
    maxHp: 3,
    fireRate: 400, // ms delay
    color: '#1abc9c'
  },
  {
    id: 'tank',
    name: 'Heavy Guard',
    description: 'Slower, but starts with more health.',
    speed: 3.5,
    maxHp: 5,
    fireRate: 600,
    color: '#8e44ad'
  }
];

// Difficulty Scaling
const DIFFICULTY_SCALE = {
  roomsMultiplier: 1.5, // More rooms per building level
  enemyCountMultiplier: 1.2,
  enemySpeedBase: 2,
  enemyAttackDelayBase: 60, // frames
};

/**
 * ==========================================
 * UTILITIES & GENERATORS
 * ==========================================
 */

// Seeded Random Number Generator (Mulberry32)
const mulberry32 = (a) => {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// Helper to get random int from seeded RNG
const getSeededInt = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min;

// Simple AABB Collision
const checkCollision = (rect1, rect2) => {
  return (
    rect1.x < rect2.x + rect2.w &&
    rect1.x + rect1.w > rect2.x &&
    rect1.y < rect2.y + rect2.h &&
    rect1.y + rect1.h > rect2.y
  );
};

const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Generate the Overworld Map (Buildings)
const generateWorldMap = () => {
  const levels = 5; // Total buildings to beat
  const buildings = [];
  for (let i = 0; i < levels; i++) {
    buildings.push({
      id: i,
      level: i + 1,
      cleared: false,
      locked: i !== 0,
      x: 100 + i * 150, // Visual position
      y: 300 + (Math.random() * 100 - 50),
    });
  }
  return buildings;
};

// Generate a single Room layout (Tiles) using a seed
const generateRoomLayout = (difficulty, seed) => {
  const rng = mulberry32(seed);
  const grid = [];
  
  const midX = Math.floor(ROOM_WIDTH / 2);
  const midY = Math.floor(ROOM_HEIGHT / 2);

  // Initialize walls and floor
  for (let y = 0; y < ROOM_HEIGHT; y++) {
    const row = [];
    for (let x = 0; x < ROOM_WIDTH; x++) {
      let type = 'floor';
      
      // Outer walls
      if (x === 0 || x === ROOM_WIDTH - 1 || y === 0 || y === ROOM_HEIGHT - 1) {
        type = 'wall';
      } else {
        // Furniture logic
        // 1. Chance to spawn
        // 2. Not in center area (keep spawn zone clear)
        // 3. Not blocking cardinal axes (door paths to center)
        
        const isCenter = Math.abs(x - midX) <= 2 && Math.abs(y - midY) <= 2;
        const isAxis = x === midX || y === midY; // Keep the cross clear for doors
        
        // Slightly increased chance (0.15) to compensate for the safe zones
        if (rng() < 0.15 && !isCenter && !isAxis) { 
            type = 'furniture';
        }
      }
      row.push({ type, x, y });
    }
    grid.push(row);
  }

  return { grid };
};

// Generate persistent items for a room using a seed
const generateRoomItems = (seed) => {
    const rng = mulberry32(seed + 999); // Offset seed for items
    const items = [];
    
    // 30% chance for items in this room
    if (rng() < 0.3) {
      const type = rng() > 0.7 ? 'pizzaBox' : 'pizza';
      items.push({
        id: Math.floor(rng() * 100000), // Unique ID for persistence
        type,
        x: getSeededInt(rng, 2, ROOM_WIDTH - 2) * TILE_SIZE + 10,
        y: getSeededInt(rng, 2, ROOM_HEIGHT - 2) * TILE_SIZE + 10,
        w: 24, h: 24
      });
    }
    return items;
}

// Generate entire Building (Graph of Rooms)
const generateBuilding = (levelIndex, rootSeed) => {
  // Derive a seed for this building based on root and level
  const buildingSeed = rootSeed + (levelIndex * 777); 
  const rng = mulberry32(buildingSeed);

  const numRooms = Math.floor(4 + levelIndex * DIFFICULTY_SCALE.roomsMultiplier);
  const rooms = [];
  
  // Create rooms structure (Assign seeds, don't generate layout yet)
  for (let i = 0; i < numRooms; i++) {
    const roomSeed = Math.floor(rng() * 1000000); // Fixed seed for this room
    rooms.push({
      id: i,
      x: 0, y: 0, // Grid coordinates on building map (virtual)
      doors: { top: null, right: null, bottom: null, left: null },
      layout: null, // Generated on fly
      seed: roomSeed,
      type: 'normal',
      cleared: false,
      explored: false, // For map tracking
      items: generateRoomItems(roomSeed) // Generate items once and persist
    });
  }

  // Deterministic Random Walk to connect rooms
  // Start at room 0 at (0,0)
  const occupiedPositions = { '0,0': 0 };
  rooms[0].x = 0;
  rooms[0].y = 0;

  const directions = [
    { x: 0, y: -1, dir: 'top', opp: 'bottom' },
    { x: 1, y: 0, dir: 'right', opp: 'left' },
    { x: 0, y: 1, dir: 'bottom', opp: 'top' },
    { x: -1, y: 0, dir: 'left', opp: 'right' }
  ];

  for (let i = 1; i < numRooms; i++) {
    // Pick a random existing room to attach to
    const parentId = getSeededInt(rng, 0, i - 1);
    const parent = rooms[parentId];
    
    // Pick a valid direction
    const validDirs = directions.filter(d => !occupiedPositions[`${parent.x + d.x},${parent.y + d.y}`]);
    
    if (validDirs.length > 0) {
      const move = validDirs[getSeededInt(rng, 0, validDirs.length - 1)];
      const child = rooms[i];
      
      child.x = parent.x + move.x;
      child.y = parent.y + move.y;
      
      // Link them
      parent.doors[move.dir] = child.id;
      child.doors[move.opp] = parent.id;
      
      occupiedPositions[`${child.x},${child.y}`] = child.id;
    }
  }

  // Set Boss Room (furthest or just the last one generated)
  rooms[rooms.length - 1].type = 'boss';
  // Clear items from boss room so we don't block the exit or look weird
  rooms[rooms.length - 1].items = [];

  return { rooms, startRoomId: 0 };
};

/**
 * ==========================================
 * GAME ENGINE & REACT COMPONENTS
 * ==========================================
 */

const VirtualJoystick = ({ onMove }) => {
  const stickRef = useRef(null);
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const center = { x: 60, y: 60 }; // Radius

  const handleStart = (e) => {
    setActive(true);
    updatePos(e);
  };

  const handleMove = (e) => {
    if (!active) return;
    updatePos(e);
  };

  const handleEnd = () => {
    setActive(false);
    setPos({ x: 0, y: 0 });
    onMove({ x: 0, y: 0 });
  };

  const updatePos = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    const rect = stickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDist = 40;
    
    if (distance > maxDist) {
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * maxDist;
      dy = Math.sin(angle) * maxDist;
    }

    setPos({ x: dx, y: dy });
    onMove({ x: dx / maxDist, y: dy / maxDist });
  };

  return (
    <div 
      ref={stickRef}
      className="absolute bottom-8 left-8 w-32 h-32 rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/30 touch-none flex items-center justify-center"
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
      onMouseDown={handleStart}
      onMouseMove={handleMove}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
    >
      <div 
        className="w-12 h-12 rounded-full bg-white/50 shadow-lg"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      />
    </div>
  );
};

export default function App() {
  const [gameState, setGameState] = useState('MENU'); // MENU, MAP, PLAYING, GAMEOVER, VICTORY, PAUSED
  const [selectedChar, setSelectedChar] = useState(CHARACTERS[0]);
  const [worldMap, setWorldMap] = useState([]);
  const [currentBuildingId, setCurrentBuildingId] = useState(0);
  const [playerStats, setPlayerStats] = useState({ hp: 3, maxHp: 3, score: 0 });
  const [activeRoomId, setActiveRoomId] = useState(0);
  const [rootSeed, setRootSeed] = useState(Date.now()); // Master seed for the game session

  // Refs for Game Loop
  const canvasRef = useRef(null);
  const requestRef = useRef();
  const gameData = useRef({
    player: { x: 0, y: 0, vx: 0, vy: 0, cooldown: 0, facing: {x:1, y:0} },
    building: null,
    projectiles: [],
    enemies: [],
    items: [],
    particles: [],
    input: { x: 0, y: 0, fire: false },
    lastTime: 0
  });

  // Sound placeholders (log only)
  const playSound = (type) => {
    // console.log(`Playing sound: ${type}`);
  };

  // --- INITIALIZATION ---

  const startGame = () => {
    const seed = Date.now();
    setRootSeed(seed);
    const map = generateWorldMap();
    setWorldMap(map);
    setPlayerStats({ ...playerStats, hp: selectedChar.maxHp, maxHp: selectedChar.maxHp, score: 0 });
    setGameState('MAP');
  };

  const enterBuilding = (buildingId) => {
    setCurrentBuildingId(buildingId);
    
    // Generate building structure using the root seed and building ID
    const building = generateBuilding(buildingId, rootSeed);
    gameData.current.building = building;
    setActiveRoomId(building.startRoomId);
    
    // Reset Player Position to center of room
    gameData.current.player.x = (ROOM_WIDTH * TILE_SIZE) / 2;
    gameData.current.player.y = (ROOM_HEIGHT * TILE_SIZE) / 2;
    gameData.current.projectiles = [];
    gameData.current.particles = [];
    
    // Populate current room
    setupRoom(building.startRoomId, building);
    
    setGameState('PLAYING');
  };

  const setupRoom = (roomId, buildingData) => {
    const room = buildingData.rooms.find(r => r.id === roomId);
    
    // Mark explored for Map
    room.explored = true;

    // 1. Generate Layout on the fly using fixed seed
    // We attach it to the room object temporarily for collision/rendering to access
    room.layout = generateRoomLayout(currentBuildingId, room.seed);
    
    gameData.current.enemies = [];
    gameData.current.items = []; // Start empty, then load from persistent storage

    // 2. Load Items (Persistent)
    // We clone the items so we can modify the local display list if needed, 
    // but actual removal happens on the room.items array
    gameData.current.items = [...room.items];

    // 3. Generate Enemies (Refreshed every time we enter)
    // We use Math.random() here as requested ("refreshed each time")
    const difficulty = currentBuildingId;
    const isStartRoom = roomId === buildingData.startRoomId && difficulty === 0;

    if (!room.cleared && !isStartRoom && room.type !== 'boss') {
      const enemyCount = Math.floor(2 + difficulty * DIFFICULTY_SCALE.enemyCountMultiplier);
      for (let i = 0; i < enemyCount; i++) {
        // Find valid spawn point
        let ex, ey, valid = false;
        while (!valid) {
           ex = getRandomInt(2, ROOM_WIDTH - 2) * TILE_SIZE;
           ey = getRandomInt(2, ROOM_HEIGHT - 2) * TILE_SIZE;
           // Check wall collision for spawn
           // Note: checkWallCollision uses room.layout which we just generated
           if (!checkWallCollision(ex, ey, room)) {
                // Simple distance check from player
                const dist = Math.hypot(ex - gameData.current.player.x, ey - gameData.current.player.y);
                if (dist > 150) valid = true;
           }
        }

        gameData.current.enemies.push({
          x: ex, y: ey,
          w: 32, h: 32,
          hp: 2 + difficulty,
          maxHp: 2 + difficulty,
          state: 'CHASE', 
          timer: 0,
          speed: (1.5 + difficulty * 0.1) * DIFFICULTY_SCALE.enemySpeedBase,
          color: COLORS.enemy
        });
      }
    }
  };

  // --- GAME LOOP ---

  const update = (dt) => {
    if (gameState !== 'PLAYING') return;

    const g = gameData.current;
    const building = g.building;
    const currentRoom = building.rooms.find(r => r.id === activeRoomId);
    
    // 1. Player Movement
    const speed = selectedChar.speed;
    const nextX = g.player.x + g.input.x * speed;
    const nextY = g.player.y + g.input.y * speed;

    // Resolve Collision with Map
    if (!checkWallCollision(nextX, g.player.y, currentRoom)) g.player.x = nextX;
    if (!checkWallCollision(g.player.x, nextY, currentRoom)) g.player.y = nextY;

    // Update facing
    if (g.input.x !== 0 || g.input.y !== 0) {
      g.player.facing = { x: g.input.x, y: g.input.y };
    }

    // 2. Door Transitions
    const doorHit = checkDoorCollision(g.player.x, g.player.y, currentRoom);
    if (doorHit) {
      if (doorHit === 'boss') {
        // Complete Level
        completeLevel();
        return;
      } else {
        // Move to next room
        const nextRoomId = currentRoom.doors[doorHit];
        if (nextRoomId !== null) {
            transitionRoom(doorHit, nextRoomId);
            return; // Skip rest of frame
        }
      }
    }

    // 3. Combat & Projectiles
    if (g.input.fire && g.player.cooldown <= 0) {
      g.projectiles.push({
        x: g.player.x + 16,
        y: g.player.y + 16,
        vx: (g.input.x || g.player.facing.x || 1) * 10, // Default fire direction if idle
        vy: (g.input.y || g.player.facing.y) * 10,
        life: 60 // frames
      });
      g.player.cooldown = selectedChar.fireRate / (1000/60);
      playSound('shoot');
    }
    if (g.player.cooldown > 0) g.player.cooldown--;

    // Update Projectiles
    g.projectiles = g.projectiles.filter(p => p.life > 0);
    g.projectiles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      
      // Check collision with walls
      if (checkWallCollision(p.x, p.y, currentRoom)) p.life = 0;

      // Check collision with enemies
      g.enemies.forEach(e => {
        if (checkCollision({x: p.x, y: p.y, w: 10, h: 10}, e)) {
          e.state = 'STUNNED';
          e.timer = 60; // Stun duration
          e.hp -= 1;
          p.life = 0;
          createParticles(e.x, e.y, COLORS.enemy);
        }
      });
    });

    // Remove dead enemies
    const deadEnemies = g.enemies.filter(e => e.hp <= 0);
    if (deadEnemies.length > 0) {
        setPlayerStats(prev => ({...prev, score: prev.score + (deadEnemies.length * 100)}));
        currentRoom.cleared = true; 
        if (g.enemies.filter(e => e.hp > 0).length === 0) currentRoom.cleared = true;
    }
    g.enemies = g.enemies.filter(e => e.hp > 0);


    // 4. Enemy AI
    g.enemies.forEach(e => {
      if (e.state === 'STUNNED') {
        e.timer--;
        if (e.timer <= 0) e.state = 'CHASE';
        return;
      }

      const dist = Math.hypot(g.player.x - e.x, g.player.y - e.y);

      if (e.state === 'CHASE') {
        if (dist < 40) { // Reach player range
          e.state = 'PREPARE';
          e.timer = 30 + (currentBuildingId * 5); // Delay before attack
        } else {
            // Simple movement towards player
            const angle = Math.atan2(g.player.y - e.y, g.player.x - e.x);
            const nextEX = e.x + Math.cos(angle) * (e.speed * 0.5); // Slower than player
            const nextEY = e.y + Math.sin(angle) * (e.speed * 0.5);
            
            // Basic Entity collision
            if (!checkWallCollision(nextEX, e.y, currentRoom)) e.x = nextEX;
            if (!checkWallCollision(e.x, nextEY, currentRoom)) e.y = nextEY;
        }
      } else if (e.state === 'PREPARE') {
        e.timer--;
        if (e.timer <= 0) {
          e.state = 'ATTACK';
          // Deal damage if still close
          if (dist < 50) {
             takeDamage();
          }
          e.timer = 60; // Cooldown
        }
      } else if (e.state === 'ATTACK') {
        e.timer--;
        if (e.timer <= 0) e.state = 'CHASE';
      }
    });

    // 5. Items (Persistent Removal)
    g.items = g.items.filter(item => {
        if (checkCollision({x: item.x, y: item.y, w: item.w, h: item.h}, {x: g.player.x, y: g.player.y, w: 32, h: 32})) {
            if (item.type === 'pizza') {
                setPlayerStats(prev => ({ ...prev, hp: Math.min(prev.hp + 1, prev.maxHp) }));
            } else if (item.type === 'pizzaBox') {
                setPlayerStats(prev => ({ ...prev, maxHp: prev.maxHp + 1, hp: prev.hp + 1 }));
            }
            createParticles(item.x, item.y, '#f1c40f');
            playSound('powerup');
            
            // REMOVE FROM PERSISTENT STORAGE
            const persistentRoom = g.building.rooms.find(r => r.id === activeRoomId);
            if (persistentRoom && persistentRoom.items) {
                persistentRoom.items = persistentRoom.items.filter(i => i.id !== item.id);
            }

            return false; // Remove item from current frame
        }
        return true;
    });

    // 6. Particles
    g.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life--; });
    g.particles = g.particles.filter(p => p.life > 0);

  };

  const takeDamage = () => {
      setPlayerStats(prev => {
          const newHp = prev.hp - 1;
          if (newHp <= 0) {
              setGameState('GAMEOVER');
          }
          return { ...prev, hp: newHp };
      });
      createParticles(gameData.current.player.x, gameData.current.player.y, '#ff0000');
      playSound('hit');
      
      // Knockback
      gameData.current.player.x -= gameData.current.player.facing.x * 50;
      gameData.current.player.y -= gameData.current.player.facing.y * 50;
  };

  const checkWallCollision = (x, y, room) => {
    // Check boundaries
    const gridX = Math.floor((x + 16) / TILE_SIZE); // Center point approx
    const gridY = Math.floor((y + 16) / TILE_SIZE);

    if (gridY < 0 || gridY >= ROOM_HEIGHT || gridX < 0 || gridX >= ROOM_WIDTH) return true;

    // IMPORTANT: checkWallCollision now expects room.layout to be present (generated in setupRoom)
    const tile = room.layout.grid[gridY][gridX];
    
    // Allow walking through doors
    if (tile.type === 'wall' || tile.type === 'furniture') {
        const isDoor = Object.entries(room.doors).some(([dir, id]) => {
           if (!id && id !== 0) return false;
           // Check if this tile corresponds to a door
           if (dir === 'top' && gridY === 0 && gridX === Math.floor(ROOM_WIDTH/2)) return true;
           if (dir === 'bottom' && gridY === ROOM_HEIGHT-1 && gridX === Math.floor(ROOM_WIDTH/2)) return true;
           if (dir === 'left' && gridX === 0 && gridY === Math.floor(ROOM_HEIGHT/2)) return true;
           if (dir === 'right' && gridX === ROOM_WIDTH-1 && gridY === Math.floor(ROOM_HEIGHT/2)) return true;
           return false;
        });
        
        // Also check Boss Door
        if (room.type === 'boss') {
           const midX = Math.floor(ROOM_WIDTH/2);
           const midY = Math.floor(ROOM_HEIGHT/2);
           
           // Determine Boss Door Location (Consistent Priority: Top -> Right -> Bottom -> Left)
           let bossDir = 'top';
           if (room.doors.top !== null) bossDir = 'right';
           if (bossDir === 'right' && room.doors.right !== null) bossDir = 'bottom';
           if (bossDir === 'bottom' && room.doors.bottom !== null) bossDir = 'left';

           if (bossDir === 'top' && gridY === 0 && gridX === midX) return false;
           if (bossDir === 'right' && gridX === ROOM_WIDTH-1 && gridY === midY) return false;
           if (bossDir === 'bottom' && gridY === ROOM_HEIGHT-1 && gridX === midX) return false;
           if (bossDir === 'left' && gridX === 0 && gridY === midY) return false;
        }

        return !isDoor;
    }
    return false;
  };

  const checkDoorCollision = (x, y, room) => {
      const cx = x + 16;
      const cy = y + 16;
      
      // Helper to check rect overlap with door zones
      const midX = (ROOM_WIDTH * TILE_SIZE) / 2;
      const midY = (ROOM_HEIGHT * TILE_SIZE) / 2;
      // const doorSize = TILE_SIZE; // Unused variable

      if (room.doors.top !== null && cy < TILE_SIZE) return 'top';
      if (room.doors.bottom !== null && cy > (ROOM_HEIGHT-1)*TILE_SIZE) return 'bottom';
      if (room.doors.left !== null && cx < TILE_SIZE) return 'left';
      if (room.doors.right !== null && cx > (ROOM_WIDTH-1)*TILE_SIZE) return 'right';

      // Boss Door (Exit) - Only if in boss room
      if (room.type === 'boss') {
          let bossDir = 'top';
          if (room.doors.top !== null) bossDir = 'right';
          if (bossDir === 'right' && room.doors.right !== null) bossDir = 'bottom';
          if (bossDir === 'bottom' && room.doors.bottom !== null) bossDir = 'left';

          if (bossDir === 'top' && cy < TILE_SIZE && Math.abs(cx - midX) < TILE_SIZE) return 'boss';
          if (bossDir === 'right' && cx > (ROOM_WIDTH-1)*TILE_SIZE && Math.abs(cy - midY) < TILE_SIZE) return 'boss';
          if (bossDir === 'bottom' && cy > (ROOM_HEIGHT-1)*TILE_SIZE && Math.abs(cx - midX) < TILE_SIZE) return 'boss';
          if (bossDir === 'left' && cx < TILE_SIZE && Math.abs(cy - midY) < TILE_SIZE) return 'boss';
      }

      return null;
  };

  const transitionRoom = (direction, nextRoomId) => {
    setActiveRoomId(nextRoomId);
    const g = gameData.current;
    
    // Reposition player to opposite side
    if (direction === 'top') g.player.y = (ROOM_HEIGHT - 2) * TILE_SIZE;
    if (direction === 'bottom') g.player.y = TILE_SIZE * 1.5;
    if (direction === 'left') g.player.x = (ROOM_WIDTH - 2) * TILE_SIZE;
    if (direction === 'right') g.player.x = TILE_SIZE * 1.5;

    // Reset particles
    g.particles = [];
    g.projectiles = [];
    
    setupRoom(nextRoomId, g.building);
  };

  const createParticles = (x, y, color) => {
      for(let i=0; i<5; i++) {
          gameData.current.particles.push({
              x, y,
              vx: (Math.random() - 0.5) * 5,
              vy: (Math.random() - 0.5) * 5,
              life: 20,
              color
          });
      }
  };

  const completeLevel = () => {
    // Unlock next building
    const nextId = currentBuildingId + 1;
    const newMap = [...worldMap];
    
    // Mark current as cleared
    newMap[currentBuildingId].cleared = true;

    if (nextId < newMap.length) {
        newMap[nextId].locked = false;
        setWorldMap(newMap);
        setGameState('MAP');
    } else {
        setGameState('VICTORY');
    }
  };

  // --- MINIMAP ---

  const drawMiniMap = (ctx, building, activeRoomId) => {
    // 1. Calculate Bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    building.rooms.forEach(r => {
        if(r.x < minX) minX = r.x;
        if(r.x > maxX) maxX = r.x;
        if(r.y < minY) minY = r.y;
        if(r.y > maxY) maxY = r.y;
    });

    const mapScale = 16; // Size of a room on map
    const gap = 8;
    const padding = 10;
    
    // Map dimensions
    const mapW = (maxX - minX + 1) * (mapScale + gap) - gap;
    const mapH = (maxY - minY + 1) * (mapScale + gap) - gap;

    // Position: Top Right with margins
    const startX = ctx.canvas.width - mapW - 20 - padding * 2;
    const startY = 20;

    // Draw Background
    ctx.fillStyle = COLORS.minimapBg;
    ctx.fillRect(startX, startY, mapW + padding * 2, mapH + padding * 2);

    // Helper to get screen pos from grid pos
    const getPos = (rx, ry) => ({
        x: startX + padding + (rx - minX) * (mapScale + gap),
        y: startY + padding + (ry - minY) * (mapScale + gap)
    });

    // Draw Connections
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    building.rooms.forEach(r => {
        const p1 = getPos(r.x, r.y);
        const center1 = { x: p1.x + mapScale/2, y: p1.y + mapScale/2 };
        
        Object.entries(r.doors).forEach(([dir, neighborId]) => {
            if (neighborId !== null) {
                const neighbor = building.rooms.find(n => n.id === neighborId);
                if (neighbor) {
                    const p2 = getPos(neighbor.x, neighbor.y);
                    const center2 = { x: p2.x + mapScale/2, y: p2.y + mapScale/2 };
                    ctx.beginPath();
                    ctx.moveTo(center1.x, center1.y);
                    ctx.lineTo(center2.x, center2.y);
                    ctx.stroke();
                }
            }
        });
    });

    // Draw Rooms
    building.rooms.forEach(r => {
        const p = getPos(r.x, r.y);
        
        if (r.id === activeRoomId) {
            ctx.fillStyle = COLORS.minimapActive;
        } else if (r.explored) {
            ctx.fillStyle = COLORS.minimapExplored;
        } else {
            // Unexplored but known layout
            ctx.fillStyle = COLORS.minimapRoom;
        }

        // Draw Rect
        ctx.fillRect(p.x, p.y, mapScale, mapScale);

        // Boss Room Indicator
        if (r.type === 'boss') {
            ctx.strokeStyle = COLORS.minimapBoss;
            ctx.lineWidth = 2;
            ctx.strokeRect(p.x, p.y, mapScale, mapScale);
        }

        // Item Hint (Visible even if unexplored)
        if (r.items && r.items.length > 0) {
            ctx.fillStyle = COLORS.minimapItem;
            ctx.beginPath();
            ctx.arc(p.x + mapScale/2, p.y + mapScale/2, 3, 0, Math.PI*2);
            ctx.fill();
        }
    });
  };

  // --- RENDERING ---

  const draw = (ctx) => {
    // Clear
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (gameState !== 'PLAYING') return;
    
    const g = gameData.current;
    const room = g.building.rooms.find(r => r.id === activeRoomId);

    // 1. Draw Map (Tiles)
    // NOTE: using room.layout which is now generated in setupRoom
    if (room.layout) {
        room.layout.grid.forEach(row => {
            row.forEach(tile => {
                const tx = tile.x * TILE_SIZE;
                const ty = tile.y * TILE_SIZE;
                
                if (tile.type === 'wall') {
                    ctx.fillStyle = COLORS.wall;
                    ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
                    // Bevel effect
                    ctx.fillStyle = 'rgba(255,255,255,0.1)';
                    ctx.fillRect(tx, ty, TILE_SIZE, 4);
                } else if (tile.type === 'furniture') {
                    ctx.fillStyle = COLORS.furniture;
                    ctx.fillRect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
                } else {
                    ctx.fillStyle = COLORS.floor;
                    ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
                    // Grid lines slightly visible
                    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
                    ctx.strokeRect(tx, ty, TILE_SIZE, TILE_SIZE);
                }
            });
        });
    }

    // 2. Draw Doors
    const drawDoor = (x, y, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        // Door frame
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
    };

    const midX = Math.floor(ROOM_WIDTH/2) * TILE_SIZE;
    const midY = Math.floor(ROOM_HEIGHT/2) * TILE_SIZE;

    if (room.doors.top !== null) drawDoor(midX, 0, COLORS.door);
    if (room.doors.bottom !== null) drawDoor(midX, (ROOM_HEIGHT-1)*TILE_SIZE, COLORS.door);
    if (room.doors.left !== null) drawDoor(0, midY, COLORS.door);
    if (room.doors.right !== null) drawDoor((ROOM_WIDTH-1)*TILE_SIZE, midY, COLORS.door);
    
    if (room.type === 'boss') {
        // Draw boss door (Exit)
        let bossDir = 'top';
        if (room.doors.top !== null) bossDir = 'right';
        if (bossDir === 'right' && room.doors.right !== null) bossDir = 'bottom';
        if (bossDir === 'bottom' && room.doors.bottom !== null) bossDir = 'left';

        if (bossDir === 'top') drawDoor(midX, 0, COLORS.bossDoor);
        else if (bossDir === 'right') drawDoor((ROOM_WIDTH-1)*TILE_SIZE, midY, COLORS.bossDoor);
        else if (bossDir === 'bottom') drawDoor(midX, (ROOM_HEIGHT-1)*TILE_SIZE, COLORS.bossDoor);
        else if (bossDir === 'left') drawDoor(0, midY, COLORS.bossDoor);
    }

    // 3. Draw Items
    g.items.forEach(item => {
        ctx.fillStyle = item.type === 'pizza' ? COLORS.pizza : COLORS.pizzaBox;
        ctx.fillRect(item.x, item.y, item.w, item.h);
        // Label
        ctx.fillStyle = 'white';
        ctx.font = '10px sans-serif';
        ctx.fillText(item.type === 'pizza' ? 'HP' : 'MAX', item.x + 2, item.y - 5);
    });

    // 4. Draw Enemies
    g.enemies.forEach(e => {
        ctx.fillStyle = e.state === 'STUNNED' ? '#95a5a6' : e.color;
        ctx.beginPath();
        ctx.arc(e.x + 16, e.y + 16, 14, 0, Math.PI * 2);
        ctx.fill();
        
        // HP Bar
        ctx.fillStyle = 'red';
        ctx.fillRect(e.x, e.y - 10, 32, 4);
        ctx.fillStyle = 'green';
        ctx.fillRect(e.x, e.y - 10, 32 * (e.hp / e.maxHp), 4);

        // Attack Indicator
        if (e.state === 'PREPARE') {
            ctx.strokeStyle = 'yellow';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(e.x + 16, e.y + 16, 20, 0, Math.PI * 2);
            ctx.stroke();
        }
    });

    // 5. Draw Player
    ctx.fillStyle = selectedChar.color;
    // Body
    ctx.fillRect(g.player.x, g.player.y, 32, 32);
    // Eyes (direction)
    ctx.fillStyle = 'white';
    const faceX = g.player.facing.x || 0;
    const faceY = g.player.facing.y || 0;
    ctx.fillRect(g.player.x + 10 + faceX * 6, g.player.y + 8 + faceY * 6, 4, 4);
    ctx.fillRect(g.player.x + 20 + faceX * 6, g.player.y + 8 + faceY * 6, 4, 4);

    // 6. Projectiles
    ctx.fillStyle = COLORS.projectile;
    g.projectiles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
    });

    // 7. Particles
    g.particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / 20;
        ctx.fillRect(p.x, p.y, 4, 4);
        ctx.globalAlpha = 1.0;
    });

    // 8. Draw MiniMap
    if (g.building) {
        drawMiniMap(ctx, g.building, activeRoomId);
    }
  };

  // --- LOOP SETUP ---
  const tick = useCallback((time) => {
    const dt = time - gameData.current.lastTime;
    gameData.current.lastTime = time;
    
    update(dt);
    
    const canvas = canvasRef.current;
    if (canvas) {
        const ctx = canvas.getContext('2d');
        draw(ctx);
    }
    
    requestRef.current = requestAnimationFrame(tick);
  }, [gameState, activeRoomId, currentBuildingId]); // Re-bind if these change significantly

  useEffect(() => {
    requestRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(requestRef.current);
  }, [tick]);

  // Input Listeners (Keyboard)
  useEffect(() => {
    const handleKeyDown = (e) => {
        const k = e.key;
        if (k === 'ArrowUp' || k === 'w') gameData.current.input.y = -1;
        if (k === 'ArrowDown' || k === 's') gameData.current.input.y = 1;
        if (k === 'ArrowLeft' || k === 'a') gameData.current.input.x = -1;
        if (k === 'ArrowRight' || k === 'd') gameData.current.input.x = 1;
        if (k === ' ' || k === 'Enter') gameData.current.input.fire = true;
    };
    const handleKeyUp = (e) => {
        const k = e.key;
        if ((k === 'ArrowUp' || k === 'w') && gameData.current.input.y === -1) gameData.current.input.y = 0;
        if ((k === 'ArrowDown' || k === 's') && gameData.current.input.y === 1) gameData.current.input.y = 0;
        if ((k === 'ArrowLeft' || k === 'a') && gameData.current.input.x === -1) gameData.current.input.x = 0;
        if ((k === 'ArrowRight' || k === 'd') && gameData.current.input.x === 1) gameData.current.input.x = 0;
        if (k === ' ' || k === 'Enter') gameData.current.input.fire = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const handleJoystick = ({ x, y }) => {
      // Threshold to stop jitter
      const tx = Math.abs(x) < 0.1 ? 0 : x;
      const ty = Math.abs(y) < 0.1 ? 0 : y;
      gameData.current.input.x = tx;
      gameData.current.input.y = ty;
  };

  const handleFireBtn = (active) => {
      gameData.current.input.fire = active;
  };

  /**
   * ==========================================
   * RENDER UI
   * ==========================================
   */

  return (
    <div className="w-full h-screen bg-slate-900 overflow-hidden relative select-none touch-none text-white font-sans">
      
      {/* CANVAS LAYER */}
      <canvas
        ref={canvasRef}
        width={ROOM_WIDTH * TILE_SIZE}
        height={ROOM_HEIGHT * TILE_SIZE}
        className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black shadow-2xl"
        style={{
            maxWidth: '100%',
            maxHeight: '100%',
            width: 'auto',
            height: 'auto',
            imageRendering: 'pixelated'
        }}
      />

      {/* --- HUD (PLAYING) --- */}
      {gameState === 'PLAYING' && (
        <>
            <div className="absolute top-4 left-4 flex gap-2">
                {Array.from({length: playerStats.maxHp}).map((_, i) => (
                    <Heart 
                        key={i} 
                        size={24} 
                        fill={i < playerStats.hp ? "red" : "none"} 
                        className={i < playerStats.hp ? "text-red-500" : "text-gray-600"}
                    />
                ))}
            </div>
            <div className="absolute top-4 right-4 text-xl font-bold text-yellow-400">
                Score: {playerStats.score}
            </div>

            {/* Mobile Controls */}
            <div className="lg:hidden">
                <VirtualJoystick onMove={handleJoystick} />
                
                <button 
                    className="absolute bottom-10 right-10 w-24 h-24 rounded-full bg-red-500/50 border-4 border-red-400 active:bg-red-500/80 flex items-center justify-center backdrop-blur-sm"
                    onTouchStart={() => handleFireBtn(true)}
                    onTouchEnd={() => handleFireBtn(false)}
                    onMouseDown={() => handleFireBtn(true)}
                    onMouseUp={() => handleFireBtn(false)}
                >
                    <Crosshair size={40} />
                </button>
            </div>
            
            {/* Desktop Hint */}
            <div className="hidden lg:block absolute bottom-4 left-1/2 -translate-x-1/2 text-gray-400 text-sm">
                WASD to Move | Space to Fire
            </div>
        </>
      )}

      {/* --- MAIN MENU --- */}
      {gameState === 'MENU' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/95 z-50">
            <h1 className="text-4xl md:text-6xl font-bold mb-8 text-yellow-400 tracking-wider">ESCAPE THE ISLAND</h1>
            
            <div className="flex flex-col md:flex-row gap-6 mb-12">
                {CHARACTERS.map(char => (
                    <div 
                        key={char.id}
                        onClick={() => setSelectedChar(char)}
                        className={`p-6 rounded-xl border-2 cursor-pointer transition-all ${selectedChar.id === char.id ? 'border-yellow-400 bg-white/10 scale-105' : 'border-gray-600 bg-white/5 hover:bg-white/10'}`}
                    >
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-8 h-8 rounded" style={{background: char.color}}></div>
                            <h3 className="text-xl font-bold">{char.name}</h3>
                        </div>
                        <p className="text-gray-400 text-sm mb-4">{char.description}</p>
                        <div className="space-y-2 text-xs text-gray-300">
                            <div className="flex justify-between"><span>Speed</span> <div className="w-20 bg-gray-700 h-2 rounded"><div className="bg-green-500 h-full rounded" style={{width: `${(char.speed/6)*100}%`}}></div></div></div>
                            <div className="flex justify-between"><span>Health</span> <div className="w-20 bg-gray-700 h-2 rounded"><div className="bg-red-500 h-full rounded" style={{width: `${(char.maxHp/6)*100}%`}}></div></div></div>
                        </div>
                    </div>
                ))}
            </div>

            <button 
                onClick={startGame}
                className="px-8 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-xl rounded-full shadow-lg flex items-center gap-2 transition-transform hover:scale-110"
            >
                <Play fill="black" /> START ADVENTURE
            </button>
        </div>
      )}

      {/* --- MAP SELECT --- */}
      {gameState === 'MAP' && (
        <div className="absolute inset-0 bg-slate-800 z-40 overflow-hidden">
             <div className="absolute top-0 left-0 w-full p-4 bg-black/50 backdrop-blur text-center">
                 <h2 className="text-2xl font-bold">Island Map</h2>
                 <p className="text-gray-400">Select the next building to explore</p>
             </div>
             
             <div className="relative w-full h-full flex items-center overflow-x-auto px-10">
                 {/* Connecting Line */}
                 <div className="absolute top-1/2 left-0 h-2 bg-gray-700 w-[1000px] -translate-y-1/2 z-0" />
                 
                 {worldMap.map((node, index) => (
                     <div key={node.id} className="relative z-10 flex flex-col items-center mx-10 shrink-0">
                         <button
                            disabled={node.locked || node.cleared}
                            onClick={() => enterBuilding(node.id)}
                            className={`w-24 h-24 rounded-full border-4 flex items-center justify-center transition-all 
                                ${node.cleared ? 'bg-green-600 border-green-400' : 
                                  node.locked ? 'bg-gray-700 border-gray-600 grayscale cursor-not-allowed' : 
                                  'bg-blue-600 border-blue-400 animate-pulse cursor-pointer shadow-blue-500/50 shadow-lg'}`}
                         >
                             {node.cleared ? <Zap size={40} /> : <MapIcon size={32} />}
                         </button>
                         <div className="mt-4 bg-black/50 px-3 py-1 rounded">
                             Building {node.level}
                             {node.locked && <span className="ml-2 text-red-500 text-xs">LOCKED</span>}
                             {node.cleared && <span className="ml-2 text-green-500 text-xs">CLEARED</span>}
                         </div>
                     </div>
                 ))}
             </div>
        </div>
      )}

      {/* --- GAME OVER --- */}
      {gameState === 'GAMEOVER' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-red-900/90 backdrop-blur">
            <h2 className="text-6xl font-black text-white mb-4">GAME OVER</h2>
            <p className="text-xl mb-8">You fell in Building {currentBuildingId + 1}</p>
            <div className="text-2xl mb-8 font-mono bg-black/30 px-6 py-2 rounded">Final Score: {playerStats.score}</div>
            <button 
                onClick={() => setGameState('MENU')}
                className="px-8 py-3 bg-white text-red-900 font-bold rounded-full hover:bg-gray-200 flex items-center gap-2"
            >
                <RotateCcw /> Try Again
            </button>
        </div>
      )}

      {/* --- VICTORY --- */}
      {gameState === 'VICTORY' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-yellow-600/90 backdrop-blur">
            <h2 className="text-6xl font-black text-white mb-4">ESCAPED!</h2>
            <p className="text-xl mb-8">You successfully cleared the island.</p>
            <div className="text-2xl mb-8 font-mono bg-black/30 px-6 py-2 rounded">Final Score: {playerStats.score}</div>
            <button 
                onClick={() => setGameState('MENU')}
                className="px-8 py-3 bg-white text-yellow-900 font-bold rounded-full hover:bg-gray-200 flex items-center gap-2"
            >
                <RotateCcw /> Play Again
            </button>
        </div>
      )}

    </div>
  );
}