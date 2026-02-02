import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Heart, Zap, Shield, Map as MapIcon, RotateCcw, Crosshair, Pizza, Grape, Box, ShoppingBag, Bomb, Cookie, Trophy, Info, Wind, Briefcase, FileText, Key, Lock, ArrowRight, Target } from 'lucide-react';

/**
 * ==========================================
 * CONSTANTS & CONFIGURATION
 * ==========================================
 */
const TILE_SIZE = 48; 
const PLAYER_SIZE = 32;
const FPS = 60;
const FALLBACK_THEME = 'ballroom'; 
const BOMB_COST = 1; 
const HIDDEN_BUILDING_ID = 999; // Special ID for the hidden level

const THEMES = ['bathroom', 'ballroom', 'living_room', 'warehouse', 'dungeon', 'garden'];

const THEME_COLORS = {
    bathroom: { bg: '#e0f7fa', wall: '#006064', floor: '#b2ebf2', door: '#00bcd4' },
    ballroom: { bg: '#3e2723', wall: '#4e342e', floor: '#5d4037', door: '#d7ccc8' },
    living_room: { bg: '#fff3e0', wall: '#e65100', floor: '#ffcc80', door: '#ff9800' },
    warehouse: { bg: '#cfd8dc', wall: '#37474f', floor: '#90a4ae', door: '#607d8b' },
    dungeon: { bg: '#212121', wall: '#000000', floor: '#424242', door: '#757575' },
    garden: { bg: '#e8f5e9', wall: '#1b5e20', floor: '#66bb6a', door: '#81c784' }
};

const ROOM_VARIANTS = [
    { w: 15, h: 11 }, 
    { w: 11, h: 9 },  
    { w: 19, h: 13 }, 
    { w: 15, h: 15 }, 
];

const GLOBAL_ITEM_LIMITS = {
    pizzaBox: 3,
    sodaCarrier: 3,
    rollerSkates: 2,
    cookieBag: 2,
    file: 5,
    key: 1
};

const COLORS = {
  background: '#2c3e50', 
  wall: '#34495e',
  floor: '#95a5a6',
  door: '#e67e22',
  bossDoor: '#e74c3c', 
  furniture: '#7f8c8d',
  player: '#2ecc71',
  enemy: '#c0392b',
  projectile: '#f1c40f',
  pizza: '#f39c12',
  pizzaBox: '#d35400',
  soda: '#8e44ad', 
  sodaCarrier: '#9b59b6',
  rollerSkates: '#3498db',
  cookieBag: '#795548',
  file: '#ecf0f1',
  key: '#f1c40f',
  shockwave: '#8e44ad', 
  uiBg: 'rgba(0,0,0,0.7)',
  minimapBg: 'rgba(0, 0, 0, 0.6)',
  minimapRoom: '#444',
  minimapExplored: '#3498db',
  minimapActive: '#ecf0f1',
  minimapItem: '#f1c40f',
  minimapBoss: '#e74c3c',
  reticle: '#ff0000' // Target indicator color
};

const CHARACTERS = [
  {
    id: 'runner',
    name: 'Swift Scout',
    description: 'Fast, moderate MP.',
    speed: 4, 
    maxHp: 3,
    maxMp: 3,
    fireRate: 400,
    damage: 1,
    color: '#1abc9c',
  },
  {
    id: 'tank',
    name: 'Heavy Guard',
    description: 'Tough, low MP capacity.',
    speed: 3, 
    maxHp: 5,
    maxMp: 2,
    fireRate: 600,
    damage: 1,
    color: '#8e44ad',
  }
];

const DIFFICULTY_SCALE = {
  roomsMultiplier: 1.5,
  enemyCountMultiplier: 1.2,
  enemySpeedBase: 1.2, 
};

/**
 * ==========================================
 * UTILITIES & GENERATORS
 * ==========================================
 */

const mulberry32 = (a) => {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

const getSeededInt = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min;
const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Distribute special items globally across buildings
const generateWorldMap = () => {
  const columnsConfig = [1, 2, 2, 2, 1]; 
  const buildings = [];
  let idCounter = 0;

  // Create Special Item Pool (Exclude Key initially to place it specifically)
  let itemPool = [];
  Object.entries(GLOBAL_ITEM_LIMITS).forEach(([type, count]) => {
      if (type === 'key') return; 
      for(let i=0; i<count; i++) itemPool.push(type);
  });
  
  // Shuffle Pool
  for (let i = itemPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [itemPool[i], itemPool[j]] = [itemPool[j], itemPool[i]];
  }

  // 1. Generate Standard Columns
  columnsConfig.forEach((count, colIndex) => {
      for(let i=0; i<count; i++) {
          buildings.push({
              id: idCounter++,
              column: colIndex, 
              level: colIndex + 1, 
              theme: THEMES[(colIndex + i) % THEMES.length],
              cleared: false,
              locked: colIndex !== 0, 
              hidden: false,
              specialItems: [], 
              x: 0, y: 0 
          });
      }
  });

  // 2. Generate Hidden Building (Left of Start)
  buildings.push({
      id: HIDDEN_BUILDING_ID,
      column: -1, // Left of column 0
      level: 6,   // Same difficulty as last level
      theme: 'dungeon',
      cleared: false,
      locked: true,
      hidden: true, // Not visible initially
      specialItems: [],
      x: 0, y: 0
  });

  // 3. Place Key: Ensure it is NOT in the last column and NOT in the hidden building
  const lastColIdx = columnsConfig.length - 1;
  const keyCandidates = buildings.filter(b => b.id !== HIDDEN_BUILDING_ID && b.column < lastColIdx);
  
  if (keyCandidates.length > 0) {
      // Pick random valid building
      const kIdx = Math.floor(Math.random() * keyCandidates.length);
      keyCandidates[kIdx].specialItems.push('key');
  }

  // 4. Assign remaining items to buildings (Round Robin)
  let bIdx = 0;
  while(itemPool.length > 0) {
      // Skip hidden building for random loot distribution
      if (buildings[bIdx].id !== HIDDEN_BUILDING_ID) {
          buildings[bIdx].specialItems.push(itemPool.pop());
      }
      bIdx = (bIdx + 1) % buildings.length;
  }
  
  return buildings;
};

// Layout Generator + Reachability Check
const generateRoomLayout = (width, height, seed, doors, isBossRoom) => {
  const rng = mulberry32(seed);
  const grid = [];
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  // 1. Generate Base Grid
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      let type = 'floor';
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        type = 'wall';
      } else {
        // Safe Zones Logic
        let isSafe = false;
        if (Math.abs(x - midX) <= 1 && Math.abs(y - midY) <= 1) isSafe = true;
        if (doors.top !== null && x === midX && y < midY) isSafe = true;
        if (doors.bottom !== null && x === midX && y > midY) isSafe = true;
        if (doors.left !== null && y === midY && x < midX) isSafe = true;
        if (doors.right !== null && y === midY && x > midX) isSafe = true;
        
        if (isBossRoom) {
            const bossDoorX = midX + 2;
            if (y === midY && x > midX && x <= bossDoorX) isSafe = true; 
            if (x === bossDoorX && y < midY) isSafe = true; 
        }

        if (!isSafe && rng() < 0.15) { 
            type = 'furniture';
        }
      }
      row.push({ type, x, y });
    }
    grid.push(row);
  }

  // 2. Flood Fill to find valid item spots
  const reachable = [];
  const visited = new Set();
  const queue = [{x: midX, y: midY}];
  visited.add(`${midX},${midY}`);

  const dirs = [{x:0, y:1}, {x:0, y:-1}, {x:1, y:0}, {x:-1, y:0}];

  while(queue.length > 0) {
      const curr = queue.shift();
      reachable.push(curr);

      for(let d of dirs) {
          const nx = curr.x + d.x;
          const ny = curr.y + d.y;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
              const tile = grid[ny][nx];
              if (tile.type === 'floor' && !visited.has(`${nx},${ny}`)) {
                  visited.add(`${nx},${ny}`);
                  queue.push({x: nx, y: ny});
              }
          }
      }
  }

  return { grid, reachable };
};

const pickItemLocation = (rng, reachableTiles) => {
    if (reachableTiles.length === 0) return null;
    const idx = getSeededInt(rng, 0, reachableTiles.length - 1);
    const tile = reachableTiles[idx];
    reachableTiles.splice(idx, 1); 
    return tile;
};

// ROBUST GRID-BASED GENERATOR
const generateBuilding = (buildingId, difficulty, theme, rootSeed, assignedSpecialItems) => {
  const buildingSeed = rootSeed + (buildingId * 777); 
  const rng = mulberry32(buildingSeed);
  const numRooms = Math.max(2, Math.floor(4 + difficulty * DIFFICULTY_SCALE.roomsMultiplier)); 
  
  // 1. Grid Phase
  const roomPositions = [{ id: 0, x: 0, y: 0 }];
  const occupied = new Map();
  occupied.set("0,0", 0);
  const connections = new Set(); 

  const dirs = [ { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 } ];

  for (let i = 1; i < numRooms; i++) {
      let placed = false;
      let attempts = 0;
      while(attempts < 50 && !placed) {
          const parentId = getSeededInt(rng, 0, roomPositions.length - 1);
          const parent = roomPositions[parentId];
          const validDirs = dirs.filter(d => !occupied.has(`${parent.x + d.x},${parent.y + d.y}`));
          if (validDirs.length > 0) {
              const move = validDirs[getSeededInt(rng, 0, validDirs.length - 1)];
              const newX = parent.x + move.x; const newY = parent.y + move.y;
              roomPositions.push({ id: i, x: newX, y: newY });
              occupied.set(`${newX},${newY}`, i);
              const linkId = parent.id < i ? `${parent.id}-${i}` : `${i}-${parent.id}`;
              connections.add(linkId);
              placed = true;
          }
          attempts++;
      }
      if (!placed) {
          for(let parent of roomPositions) {
              const valid = dirs.find(d => !occupied.has(`${parent.x + d.x},${parent.y + d.y}`));
              if(valid) {
                  const newX = parent.x + valid.x; const newY = parent.y + valid.y;
                  roomPositions.push({ id: i, x: newX, y: newY });
                  occupied.set(`${newX},${newY}`, i);
                  connections.add(parent.id < i ? `${parent.id}-${i}` : `${i}-${parent.id}`);
                  placed = true; break;
              }
          }
      }
  }

  // 2. Object Phase
  const roomIdsForItems = roomPositions.map(r => r.id).filter(id => id !== 0 && id !== numRooms - 1);
  if (roomIdsForItems.length === 0) roomIdsForItems.push(0);

  // Distribute items deterministically to valid rooms first
  const itemsPerRoom = {};
  const itemsToPlace = [...assignedSpecialItems];
  
  while(itemsToPlace.length > 0) {
      // Pick a random room from valid list for this specific item
      const rIdx = getSeededInt(rng, 0, roomIdsForItems.length - 1);
      const roomId = roomIdsForItems[rIdx];
      
      if (!itemsPerRoom[roomId]) itemsPerRoom[roomId] = [];
      itemsPerRoom[roomId].push(itemsToPlace.pop());
  }

  const rooms = roomPositions.map(pos => {
      const roomSeed = Math.floor(rng() * 1000000); 
      const size = ROOM_VARIANTS[getSeededInt(rng, 0, ROOM_VARIANTS.length - 1)];
      
      const doors = { top: null, right: null, bottom: null, left: null };
      
      const myConns = Array.from(connections).filter(c => c.startsWith(`${pos.id}-`) || c.endsWith(`-${pos.id}`));
      myConns.forEach(conn => {
          const otherId = conn.split('-').find(id => Number(id) !== pos.id);
          const otherPos = roomPositions.find(p => p.id === Number(otherId));
          if (otherPos.y < pos.y) doors.top = otherPos.id;
          if (otherPos.y > pos.y) doors.bottom = otherPos.id;
          if (otherPos.x < pos.x) doors.left = otherPos.id;
          if (otherPos.x > pos.x) doors.right = otherPos.id;
      });

      const isBoss = (pos.id === numRooms - 1);
      
      const layoutData = generateRoomLayout(size.w, size.h, roomSeed, doors, isBoss);
      const reachable = layoutData.reachable;

      const items = [];
      const itemRng = mulberry32(roomSeed + 999);

      // A. Special Items (Deterministic)
      if (itemsPerRoom[pos.id]) {
          itemsPerRoom[pos.id].forEach(specialType => {
             const spot = pickItemLocation(itemRng, reachable);
             if (spot) {
                 items.push({ id: Math.floor(itemRng()*100000), type: specialType, x: spot.x * TILE_SIZE + 12, y: spot.y * TILE_SIZE + 12, w: 24, h: 24, isUnlimited: false });
             } else {
                 // Fallback if flood fill failed (should not happen, but safe fallback to center)
                 items.push({ id: Math.floor(itemRng()*100000), type: specialType, x: (size.w/2) * TILE_SIZE + 12, y: (size.h/2) * TILE_SIZE + 12, w: 24, h: 24, isUnlimited: false });
             }
          });
      }

      // B. Random Consumables (Unlimited)
      if (!isBoss && itemRng() < 0.3) {
          const spot = pickItemLocation(itemRng, reachable);
          if (spot) {
              const rand = itemRng();
              const type = rand < 0.5 ? 'pizza' : 'soda';
              // Note: IDs are deterministic, so we can track them
              items.push({ id: Math.floor(itemRng()*100000), type, x: spot.x * TILE_SIZE + 12, y: spot.y * TILE_SIZE + 12, w: 24, h: 24, isUnlimited: true });
          }
      }

      return {
          id: pos.id,
          x: pos.x, y: pos.y,
          width: size.w, height: size.h,
          doors,
          doorStyles: {
            top: getSeededInt(rng, 1, 5), bottom: getSeededInt(rng, 1, 5),
            left: getSeededInt(rng, 1, 5), right: getSeededInt(rng, 1, 5),
          },
          layout: layoutData, 
          seed: roomSeed,
          type: isBoss ? 'boss' : 'normal',
          cleared: false,
          explored: false,
          items
      };
  });

  return { rooms, startRoomId: 0, theme };
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

  const handleStart = (e) => { setActive(true); updatePos(e); };
  const handleMove = (e) => { if (!active) return; updatePos(e); };
  const handleEnd = () => { setActive(false); setPos({ x: 0, y: 0 }); onMove({ x: 0, y: 0 }); };
  
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
      onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}
      onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
    >
      <div 
        className="w-12 h-12 rounded-full bg-white/50 shadow-lg"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      />
    </div>
  );
};

export default function App() {
  const [gameState, setGameState] = useState('START'); 
  const [selectedChar, setSelectedChar] = useState(CHARACTERS[0]);
  const [worldMap, setWorldMap] = useState([]);
  const [currentBuildingId, setCurrentBuildingId] = useState(0);
  const [playerStats, setPlayerStats] = useState({ 
      hp: 3, maxHp: 3, mp: 3, maxMp: 3, score: 0, speed: 4, damage: 1,
      keys: 0, files: 0
  });
  const [activeRoomId, setActiveRoomId] = useState(0);
  const [rootSeed, setRootSeed] = useState(Date.now());
  const [highScore, setHighScore] = useState(0);
  const [startBgLoaded, setStartBgLoaded] = useState(false);
  const [endingPage, setEndingPage] = useState(0);
  const [messageData, setMessageData] = useState(null); // { title, text, nextState }

  const canvasRef = useRef(null);
  const requestRef = useRef();
  
  const assets = useRef({}); 
  const assetStatus = useRef({});
  // Store IDs of all collected items to prevent regeneration
  const collectedItemsRef = useRef(new Set());

  const gameData = useRef({
    player: { x: 0, y: 0, vx: 0, vy: 0, cooldown: 0, bombCooldown: 0, facing: {x:1, y:0}, frameIndex: 0, frameTimer: 0, state: 'idle' },
    building: null,
    projectiles: [],
    enemies: [],
    items: [],
    particles: [],
    shockwaves: [], 
    input: { x: 0, y: 0, fire: false, bomb: false },
    currentTarget: null, // Track currently targeted enemy for rendering
    lastTime: 0
  });

  // --- PERSISTENCE ---
  useEffect(() => {
      const saved = localStorage.getItem('escape_island_highscore');
      if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  const saveScore = (score) => {
      if (score > highScore) {
          setHighScore(score);
          localStorage.setItem('escape_island_highscore', score.toString());
      }
  };

  // --- IMAGE LOADING ---
  const loadImage = (key, src) => {
    if (assetStatus.current[key]) return;
    assetStatus.current[key] = 'loading';

    const tryLoad = (currentSrc, isRetry = false) => {
        const img = new Image();
        img.crossOrigin = "Anonymous"; 
        
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            const imgData = ctx.getImageData(0, 0, c.width, c.height);
            const data = imgData.data;
            for(let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                if (g > 100 && r < 100 && b < 100) data[i + 3] = 0; 
            }
            ctx.putImageData(imgData, 0, 0);
            assets.current[key] = c;
            assetStatus.current[key] = 'loaded';
            
            if (key === 'bg_start') {
                setStartBgLoaded(true);
            }
        };
        
        img.onerror = () => {
            if (!isRetry && currentSrc.endsWith('.png')) {
                tryLoad(currentSrc.replace('.png', '.jpg'), true);
            } else {
                console.warn(`Failed to load asset: ${src}`);
                assetStatus.current[key] = 'error';
            }
        };
        img.src = currentSrc;
    };
    tryLoad(src);
  };

  const getThemeAsset = (prefix, currentTheme, suffix) => {
      const key = suffix ? `${prefix}_${currentTheme}_${suffix}` : `${prefix}_${currentTheme}`;
      if (assets.current[key]) return assets.current[key];
      const fallbackKey = suffix ? `${prefix}_${FALLBACK_THEME}_${suffix}` : `${prefix}_${FALLBACK_THEME}`;
      if (assets.current[fallbackKey]) return assets.current[fallbackKey];
      return null;
  };

  // --- INITIALIZATION ---

  useEffect(() => {
      loadImage('bg_start', './assets/bg_start_screen.png');
  }, []);

  const initGameSession = () => {
      setGameState('CHAR_SELECT');
  }

  const startGame = () => {
    const seed = Date.now();
    setRootSeed(seed);
    collectedItemsRef.current = new Set(); // Reset collected items
    const map = generateWorldMap(); 
    setWorldMap(map);
    setPlayerStats({ 
        hp: selectedChar.maxHp, maxHp: selectedChar.maxHp, 
        mp: selectedChar.maxMp, maxMp: selectedChar.maxMp,
        speed: selectedChar.speed, damage: selectedChar.damage,
        keys: 0, files: 0, score: 0 
    });
    setGameState('MAP');
    
    loadImage(`char_${selectedChar.id}_idle`, `./assets/char_${selectedChar.id}_idle.png`);
    loadImage(`char_${selectedChar.id}_run`, `./assets/char_${selectedChar.id}_run.png`);

    ROOM_VARIANTS.forEach(size => {
        loadImage(`bg_${FALLBACK_THEME}_${size.w}_${size.h}`, `./assets/bg_${FALLBACK_THEME}_${size.w}_${size.h}.png`);
    });
    loadImage(`door_exit_${FALLBACK_THEME}`, `./assets/door_exit_${FALLBACK_THEME}.png`);
    for(let i=1; i<=5; i++) {
        loadImage(`door_${FALLBACK_THEME}_${i}`, `./assets/door_${FALLBACK_THEME}_${i}.png`);
    }
    loadImage(`enemy_${FALLBACK_THEME}`, `./assets/enemy_${FALLBACK_THEME}.png`);
  };

  const enterBuilding = (buildingId) => {
    setCurrentBuildingId(buildingId);
    const buildingNode = worldMap.find(b => b.id === buildingId);
    const theme = buildingNode ? buildingNode.theme : 'dungeon';
    const difficulty = buildingNode.id === HIDDEN_BUILDING_ID ? 5 : buildingNode.column; // Hidden is hard
    
    // Generate building deterministically
    const building = generateBuilding(buildingId, difficulty, theme, rootSeed, [...buildingNode.specialItems]); 
    
    // Filter out already collected items (Global Persistence)
    building.rooms.forEach(room => {
        room.items = room.items.filter(item => !collectedItemsRef.current.has(item.id));
    });

    gameData.current.building = building;
    setActiveRoomId(building.startRoomId);
    
    if (theme !== FALLBACK_THEME) {
        ROOM_VARIANTS.forEach(size => {
            loadImage(`bg_${theme}_${size.w}_${size.h}`, `./assets/bg_${theme}_${size.w}_${size.h}.png`);
        });
        loadImage(`door_exit_${theme}`, `./assets/door_exit_${theme}.png`);
        for(let i=1; i<=5; i++) {
            loadImage(`door_${theme}_${i}`, `./assets/door_${theme}_${i}.png`);
        }
        loadImage(`enemy_${theme}`, `./assets/enemy_${theme}.png`);
    }

    const startRoom = building.rooms.find(r => r.id === building.startRoomId);
    gameData.current.player.x = (Math.floor(startRoom.width / 2) * TILE_SIZE) + (TILE_SIZE - PLAYER_SIZE) / 2;
    gameData.current.player.y = (Math.floor(startRoom.height / 2) * TILE_SIZE) + (TILE_SIZE - PLAYER_SIZE) / 2;
    gameData.current.projectiles = [];
    gameData.current.particles = [];
    gameData.current.shockwaves = [];
    
    setupRoom(building.startRoomId, building);
    setGameState('PLAYING');
  };

  const setupRoom = (roomId, buildingData) => {
    const room = buildingData.rooms.find(r => r.id === roomId);
    room.explored = true;
    
    gameData.current.enemies = [];
    gameData.current.items = [...room.items]; 

    const buildingNode = worldMap.find(b => b.id === currentBuildingId);
    const difficulty = buildingNode.id === HIDDEN_BUILDING_ID ? 5 : buildingNode.column;
    const isStartRoom = roomId === buildingData.startRoomId && difficulty === 0;

    if (!room.cleared && !isStartRoom && room.type !== 'boss') {
      const enemyCount = Math.floor(2 + difficulty * DIFFICULTY_SCALE.enemyCountMultiplier);
      for (let i = 0; i < enemyCount; i++) {
        let ex, ey, valid = false;
        while (!valid) {
           ex = getRandomInt(2, room.width - 2) * TILE_SIZE;
           ey = getRandomInt(2, room.height - 2) * TILE_SIZE;
           if (!checkWallCollision(ex, ey, room)) {
                const dist = Math.hypot(ex - gameData.current.player.x, ey - gameData.current.player.y);
                if (dist > 150) valid = true;
           }
        }
        
        const moveSpeed = (1.0 + difficulty * 0.25) * DIFFICULTY_SCALE.enemySpeedBase;

        gameData.current.enemies.push({
          x: ex, y: ey,
          w: 32, h: 32,
          hp: 2 + difficulty,
          maxHp: 2 + difficulty,
          state: 'CHASE', 
          timer: 0,
          frameIndex: 0,
          frameTimer: 0,
          speed: moveSpeed,
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
    
    // Player
    const speed = playerStats.speed;
    const nextX = g.player.x + g.input.x * speed;
    const nextY = g.player.y + g.input.y * speed;

    const isMoving = g.input.x !== 0 || g.input.y !== 0;
    g.player.state = isMoving ? 'run' : 'idle';
    if (isMoving) {
        g.player.frameTimer++;
        if (g.player.frameTimer > 10) { 
            g.player.frameIndex = (g.player.frameIndex + 1) % 4; 
            g.player.frameTimer = 0;
        }
    } else {
        g.player.frameIndex = 0;
    }

    if (!checkWallCollision(nextX, g.player.y, currentRoom)) g.player.x = nextX;
    if (!checkWallCollision(g.player.x, nextY, currentRoom)) g.player.y = nextY;

    if (g.input.x !== 0 || g.input.y !== 0) {
      g.player.facing = { x: g.input.x, y: g.input.y };
    }

    // Transitions
    const doorHit = checkDoorCollision(g.player.x, g.player.y, currentRoom);
    if (doorHit) {
      if (doorHit === 'boss') { completeLevel(); return; }
      else {
        const nextRoomId = currentRoom.doors[doorHit];
        if (nextRoomId !== null) { transitionRoom(doorHit, nextRoomId); return; }
      }
    }

    // Determine Closest Enemy for Auto-Aim
    let closestEnemy = null;
    let minDst = 1000; // Targeting Range
    g.enemies.forEach(e => {
        // Removed check for STUNNED state to allow persistent targeting
        const dist = Math.hypot(e.x - g.player.x, e.y - g.player.y);
        if (dist < minDst) {
            minDst = dist;
            closestEnemy = e;
        }
    });
    g.currentTarget = closestEnemy; // Save for rendering reticle

    // Projectile Combat
    if (g.input.fire && g.player.cooldown <= 0) {
      let vx = 0, vy = 0;
      
      // Auto-Aim Logic
      if (closestEnemy) {
          const angle = Math.atan2(closestEnemy.y - g.player.y, closestEnemy.x - g.player.x);
          const bulletSpeed = 10;
          vx = Math.cos(angle) * bulletSpeed;
          vy = Math.sin(angle) * bulletSpeed;
      } else {
          // Fallback to manual facing
          // Normalize facing vector first to ensure consistent speed
          const len = Math.sqrt(g.player.facing.x * g.player.facing.x + g.player.facing.y * g.player.facing.y) || 1;
          vx = (g.player.facing.x / len) * 10;
          vy = (g.player.facing.y / len) * 10;
      }

      g.projectiles.push({
        x: g.player.x + 16, y: g.player.y + 16,
        vx, vy,
        life: 60 
      });
      g.player.cooldown = selectedChar.fireRate / (1000/60);
      // playSound('shoot'); 
    }
    if (g.player.cooldown > 0) g.player.cooldown--;

    // BOMB ATTACK
    if (g.input.bomb && g.player.bombCooldown <= 0) {
        if (playerStats.mp >= BOMB_COST) {
            setPlayerStats(prev => ({...prev, mp: prev.mp - BOMB_COST}));
            g.player.bombCooldown = 60; 
            g.shockwaves.push({ x: g.player.x + 16, y: g.player.y + 16, r: 10, maxR: 500, alpha: 1.0 });
            // playSound('explosion');
            g.enemies.forEach(e => {
                e.hp -= 2;
                e.state = 'STUNNED';
                e.timer = 120; 
                createParticles(e.x, e.y, COLORS.shockwave);
            });
        }
    }
    if (g.player.bombCooldown > 0) g.player.bombCooldown--;

    // Update Shockwaves
    g.shockwaves.forEach(s => {
        s.r += 15; 
        s.alpha -= 0.03; 
    });
    g.shockwaves = g.shockwaves.filter(s => s.alpha > 0);

    // Update Projectiles
    g.projectiles = g.projectiles.filter(p => p.life > 0);
    g.projectiles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.life--;
      if (checkWallCollision(p.x, p.y, currentRoom)) p.life = 0;
      g.enemies.forEach(e => {
        if (checkCollision({x: p.x, y: p.y, w: 10, h: 10}, e)) {
          e.state = 'STUNNED'; e.timer = 60; 
          e.hp -= playerStats.damage; // Use player damage stats
          p.life = 0;
          createParticles(e.x, e.y, COLORS.enemy);
        }
      });
    });

    // Check Deaths
    const deadEnemies = g.enemies.filter(e => e.hp <= 0);
    if (deadEnemies.length > 0) {
        setPlayerStats(prev => ({...prev, score: prev.score + (deadEnemies.length * 100)}));
        if (g.enemies.filter(e => e.hp > 0).length === 0) currentRoom.cleared = true;
    }
    g.enemies = g.enemies.filter(e => e.hp > 0);

    // Enemy AI
    g.enemies.forEach(e => {
      e.frameTimer++;
      if (e.frameTimer > 10) { e.frameIndex = (e.frameIndex + 1) % 4; e.frameTimer = 0; }

      if (e.state === 'STUNNED') {
        e.timer--; if (e.timer <= 0) e.state = 'CHASE'; return;
      }
      const dist = Math.hypot(g.player.x - e.x, g.player.y - e.y);
      if (e.state === 'CHASE') {
        if (dist < 40) { e.state = 'PREPARE'; e.timer = 30 + (currentBuildingId * 5); } 
        else {
            const angle = Math.atan2(g.player.y - e.y, g.player.x - e.x);
            const nextEX = e.x + Math.cos(angle) * (e.speed * 0.5); 
            const nextEY = e.y + Math.sin(angle) * (e.speed * 0.5);
            if (!checkWallCollision(nextEX, e.y, currentRoom)) e.x = nextEX;
            if (!checkWallCollision(e.x, nextEY, currentRoom)) e.y = nextEY;
        }
      } else if (e.state === 'PREPARE') {
        e.timer--; if (e.timer <= 0) { e.state = 'ATTACK'; if (dist < 50) takeDamage(); e.timer = 60; }
      } else if (e.state === 'ATTACK') {
        e.timer--; if (e.timer <= 0) e.state = 'CHASE';
      }
    });

    // Items
    g.items = g.items.filter(item => {
        if (checkCollision({x: item.x, y: item.y, w: item.w, h: item.h}, {x: g.player.x, y: g.player.y, w: 32, h: 32})) {
            let consumed = false;
            if (item.type === 'pizza') {
                if (playerStats.hp < playerStats.maxHp) {
                    setPlayerStats(prev => ({ ...prev, hp: Math.min(prev.hp + 1, prev.maxHp) })); consumed = true;
                }
            } else if (item.type === 'pizzaBox') {
                setPlayerStats(prev => ({ ...prev, maxHp: prev.maxHp + 1, hp: prev.hp + 1 })); consumed = true;
            } else if (item.type === 'soda') {
                if (playerStats.mp < playerStats.maxMp) {
                    setPlayerStats(prev => ({ ...prev, mp: Math.min(prev.mp + 1, prev.maxMp) })); consumed = true;
                }
            } else if (item.type === 'sodaCarrier') {
                setPlayerStats(prev => ({ ...prev, maxMp: prev.maxMp + 1, mp: prev.mp + 1 })); consumed = true;
            } else if (item.type === 'rollerSkates') {
                setPlayerStats(prev => ({ ...prev, speed: prev.speed + 1 })); consumed = true;
            } else if (item.type === 'cookieBag') {
                setPlayerStats(prev => ({ ...prev, damage: prev.damage + 1 })); consumed = true;
            } else if (item.type === 'file') {
                setPlayerStats(prev => ({ ...prev, files: prev.files + 1 })); consumed = true;
            } else if (item.type === 'key') {
                setPlayerStats(prev => ({ ...prev, keys: prev.keys + 1 })); consumed = true;
            }

            if (consumed) {
                createParticles(item.x, item.y, COLORS[item.type] || COLORS.pizza);
                // Add to global collection (persistence)
                collectedItemsRef.current.add(item.id);
                // Remove locally
                const persistentRoom = g.building.rooms.find(r => r.id === activeRoomId);
                if (persistentRoom && persistentRoom.items) {
                    persistentRoom.items = persistentRoom.items.filter(i => i.id !== item.id);
                }
                return false; 
            }
        }
        return true;
    });

    g.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life--; });
    g.particles = g.particles.filter(p => p.life > 0);
  };

  const takeDamage = () => {
      setPlayerStats(prev => {
          const newHp = prev.hp - 1;
          if (newHp <= 0) {
              saveScore(prev.score);
              setGameState('GAMEOVER');
          }
          return { ...prev, hp: newHp };
      });
      createParticles(gameData.current.player.x, gameData.current.player.y, '#ff0000');
      // playSound('hit');
      gameData.current.player.x -= gameData.current.player.facing.x * 50;
      gameData.current.player.y -= gameData.current.player.facing.y * 50;
  };

  const checkWallCollision = (x, y, room) => {
    const gridX = Math.floor((x + 16) / TILE_SIZE); 
    const gridY = Math.floor((y + 16) / TILE_SIZE);
    if (gridY < 0 || gridY >= room.height || gridX < 0 || gridX >= room.width) return true;
    const tile = room.layout.grid[gridY][gridX];
    if (tile.type === 'wall' || tile.type === 'furniture') {
        const isDoor = Object.entries(room.doors).some(([dir, id]) => {
           if (!id && id !== 0) return false;
           if (dir === 'top' && gridY === 0 && gridX === Math.floor(room.width/2)) return true;
           if (dir === 'bottom' && gridY === room.height-1 && gridX === Math.floor(room.width/2)) return true;
           if (dir === 'left' && gridX === 0 && gridY === Math.floor(room.height/2)) return true;
           if (dir === 'right' && gridX === room.width-1 && gridY === Math.floor(room.height/2)) return true;
           return false;
        });
        
        if (room.type === 'boss') {
           // Boss door offset logic: Top wall, midX + 2
           const bossDoorX = Math.floor(room.width/2) + 2;
           if (gridY === 0 && gridX === bossDoorX) return false;
        }
        return !isDoor;
    }
    return false;
  };

  const checkDoorCollision = (x, y, room) => {
      const cx = x + 16; const cy = y + 16;
      const midX = (room.width * TILE_SIZE) / 2;
      
      // Standard Doors
      if (room.doors.top !== null && cy < TILE_SIZE && Math.abs(cx - midX) < TILE_SIZE) return 'top';
      if (room.doors.bottom !== null && cy > (room.height-1)*TILE_SIZE && Math.abs(cx - midX) < TILE_SIZE) return 'bottom';
      if (room.doors.left !== null && cx < TILE_SIZE) return 'left';
      if (room.doors.right !== null && cx > (room.width-1)*TILE_SIZE) return 'right';

      if (room.type === 'boss') {
          // Boss Exit: Top Wall, Offset +2
          const bossDoorPixelX = (Math.floor(room.width/2) + 2) * TILE_SIZE + (TILE_SIZE/2);
          if (cy < TILE_SIZE && Math.abs(cx - bossDoorPixelX) < TILE_SIZE) return 'boss';
      }
      return null;
  };

  const transitionRoom = (direction, nextRoomId) => {
    const nextRoom = gameData.current.building.rooms.find(r => r.id === nextRoomId);
    setActiveRoomId(nextRoomId);
    const g = gameData.current;
    
    // STUCK FIX: Calculate safe positions aligned to grid center
    // We target the center of the door tile (e.g., width/2) then step 1.5 tiles in
    const midX = Math.floor(nextRoom.width / 2);
    const midY = Math.floor(nextRoom.height / 2);
    
    // Ensure centering within the tile by adding (TILE_SIZE - PLAYER_SIZE) / 2
    const centerOffset = (TILE_SIZE - PLAYER_SIZE) / 2;

    if (direction === 'top') {
        g.player.x = (midX * TILE_SIZE) + centerOffset;
        g.player.y = ((nextRoom.height - 2) * TILE_SIZE) + centerOffset;
    }
    if (direction === 'bottom') {
        g.player.x = (midX * TILE_SIZE) + centerOffset;
        g.player.y = (1.5 * TILE_SIZE); 
    }
    if (direction === 'left') {
        g.player.x = ((nextRoom.width - 2) * TILE_SIZE) + centerOffset;
        g.player.y = (midY * TILE_SIZE) + centerOffset;
    }
    if (direction === 'right') {
        g.player.x = (1.5 * TILE_SIZE);
        g.player.y = (midY * TILE_SIZE) + centerOffset;
    }

    g.particles = []; g.projectiles = [];
    // Reset Target
    g.currentTarget = null;
    setupRoom(nextRoomId, g.building);
  };

  const checkCollision = (rect1, rect2) => {
      return (rect1.x < rect2.x + rect2.w && rect1.x + rect1.w > rect2.x && rect1.y < rect2.y + rect2.h && rect1.y + rect1.h > rect2.y);
  };
  
  const createParticles = (x, y, color) => {
      for(let i=0; i<5; i++) {
          gameData.current.particles.push({x, y, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5, life: 20, color});
      }
  };

  const completeLevel = () => {
    // Current building completed
    const currentBuilding = worldMap.find(b => b.id === currentBuildingId);
    
    // Logic: Clear current, unlock all buildings in NEXT column
    const nextCol = currentBuilding.column + 1;
    let maxCol = 0;
    
    // Calculate max column first to ensure reliability
    worldMap.forEach(b => {
        if (b.column > maxCol) maxCol = b.column;
    });
    
    const newMap = worldMap.map(b => {
        if (b.id === currentBuildingId) {
            return { ...b, cleared: true };
        }
        // Don't auto-unlock hidden building via column progression
        if (b.column === nextCol && b.id !== HIDDEN_BUILDING_ID) {
            return { ...b, locked: false };
        }
        return b;
    });

    // 1. FIRST BUILDING SPECIAL MESSAGE & UNLOCK HIDDEN
    if (currentBuilding.id === 0) {
        const hasKey = playerStats.keys > 0;
        
        // If have key, also unlock hidden building in new map
        if (hasKey) {
            const hiddenIndex = newMap.findIndex(b => b.id === HIDDEN_BUILDING_ID);
            if (hiddenIndex !== -1) {
                newMap[hiddenIndex].locked = false;
                newMap[hiddenIndex].hidden = false;
            }
        }

        setWorldMap(newMap);
        setMessageData({
            title: hasKey ? "Hidden Path Revealed" : "Escaped!",
            text: hasKey 
                ? "Now you have the key, you can release all the kids!"
                : "You escaped from the building, you are the only hope of the kids in the building.",
            nextState: 'MAP'
        });
        setGameState('MESSAGE');
        return;
    }

    setWorldMap(newMap);

    // 2. ENDING LOGIC
    // If we just cleared the Final Column (Column 4)
    if (currentBuilding.column === maxCol) {
        saveScore(playerStats.score);
        setEndingPage(0);
        setGameState('ENDING');
    } else {
        setGameState('MAP'); 
    }
  };

  // --- RENDERING ---

  const draw = (ctx) => {
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (gameState !== 'PLAYING') return;
    
    const g = gameData.current;
    const room = g.building.rooms.find(r => r.id === activeRoomId);
    const theme = g.building.theme;
    const themeColors = THEME_COLORS[theme] || THEME_COLORS[FALLBACK_THEME];

    const bgImg = getThemeAsset('bg', theme, `${room.width}_${room.height}`);
    if (bgImg) {
        ctx.drawImage(bgImg, 0, 0, room.width * TILE_SIZE, room.height * TILE_SIZE);
    } else {
        // Fallback: Grid with Theme Colors
        if (room.layout) {
            room.layout.grid.forEach(row => {
                row.forEach(tile => {
                    const tx = tile.x * TILE_SIZE; const ty = tile.y * TILE_SIZE;
                    if (tile.type === 'wall') { ctx.fillStyle = themeColors.wall; ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE); } 
                    else if (tile.type === 'furniture') { ctx.fillStyle = COLORS.furniture; ctx.fillRect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8); } 
                    else { ctx.fillStyle = themeColors.floor; ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE); ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.strokeRect(tx, ty, TILE_SIZE, TILE_SIZE); }
                });
            });
        }
    }

    // Doors
    const drawDoor = (x, y, dir, isBoss) => {
        let doorImg;
        if (isBoss) {
            doorImg = getThemeAsset('door', theme, 'exit'); 
            if (!doorImg) doorImg = getThemeAsset('door_exit', theme); 
        } else {
            doorImg = getThemeAsset('door', theme, room.doorStyles[dir]);
        }
        if (doorImg) ctx.drawImage(doorImg, x, y, TILE_SIZE, TILE_SIZE);
        else {
            ctx.fillStyle = isBoss ? COLORS.bossDoor : themeColors.door;
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            ctx.strokeStyle = '#fff'; ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
        }
    };
    const midX = Math.floor(room.width/2) * TILE_SIZE;
    const midY = Math.floor(room.height/2) * TILE_SIZE;
    if (room.doors.top !== null) drawDoor(midX, 0, 'top', false);
    if (room.doors.bottom !== null) drawDoor(midX, (room.height-1)*TILE_SIZE, 'bottom', false);
    if (room.doors.left !== null) drawDoor(0, midY, 'left', false);
    if (room.doors.right !== null) drawDoor((room.width-1)*TILE_SIZE, midY, 'right', false);
    
    if (room.type === 'boss') {
        // Boss Door at Top, Offset +2
        const bossDoorX = (Math.floor(room.width/2) + 2) * TILE_SIZE;
        drawDoor(bossDoorX, 0, 'top', true);
    }

    // Items
    g.items.forEach(item => {
        let color = COLORS.pizza;
        if (item.type === 'pizzaBox') color = COLORS.pizzaBox;
        else if (item.type === 'soda') color = COLORS.soda;
        else if (item.type === 'sodaCarrier') color = COLORS.sodaCarrier;
        else if (item.type === 'rollerSkates') color = COLORS.rollerSkates;
        else if (item.type === 'cookieBag') color = COLORS.cookieBag;
        else if (item.type === 'file') color = COLORS.file;
        else if (item.type === 'key') color = COLORS.key;
        
        // Draw Item Body
        ctx.fillStyle = color; 
        ctx.fillRect(item.x, item.y, item.w, item.h);
        
        // Simple Icon/Text overlay
        ctx.fillStyle = 'white'; 
        ctx.font = '10px sans-serif';
        let label = '';
        if(item.type === 'pizzaBox') label = '+HP';
        else if(item.type === 'soda') label = 'MP';
        else if(item.type === 'sodaCarrier') label = '+MP';
        else if(item.type === 'rollerSkates') label = 'SPD';
        else if(item.type === 'cookieBag') label = 'DMG';
        else if(item.type === 'file') label = 'FILE';
        else if(item.type === 'key') label = 'KEY';
        
        if (label) ctx.fillText(label, item.x, item.y - 5);
    });

    // Enemies
    const enemyImg = getThemeAsset('enemy', theme);
    g.enemies.forEach(e => {
        if (enemyImg) {
             const frameW = enemyImg.width / 4; const frameH = enemyImg.height; 
             ctx.drawImage(enemyImg, e.frameIndex * frameW, 0, frameW, frameH, e.x, e.y, 32, 32);
        } else {
            ctx.fillStyle = e.state === 'STUNNED' ? '#95a5a6' : COLORS.enemy;
            ctx.beginPath(); ctx.arc(e.x + 16, e.y + 16, 14, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'red'; ctx.fillRect(e.x, e.y - 10, 32, 4);
        ctx.fillStyle = 'green'; ctx.fillRect(e.x, e.y - 10, 32 * (e.hp / e.maxHp), 4);
    });

    // TARGET RETICLE (Auto-Aim Visual)
    if (g.currentTarget) {
        ctx.strokeStyle = COLORS.reticle;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 2]); // Dashed line
        ctx.beginPath();
        // Rotating circle effect can be added with time, simple circle for now
        ctx.arc(g.currentTarget.x + 16, g.currentTarget.y + 16, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]); // Reset dash
    }

    // Player
    const charKey = `char_${selectedChar.id}_${g.player.state}`;
    const charImg = assets.current[charKey];
    if (charImg) {
        const frameW = charImg.width / 4; const frameH = charImg.height;
        ctx.save();
        if (g.player.facing.x < 0) {
            ctx.translate(g.player.x + 32, g.player.y); ctx.scale(-1, 1);
            ctx.drawImage(charImg, g.player.frameIndex * frameW, 0, frameW, frameH, 0, 0, 32, 32);
        } else {
            ctx.drawImage(charImg, g.player.frameIndex * frameW, 0, frameW, frameH, g.player.x, g.player.y, 32, 32);
        }
        ctx.restore();
    } else {
        ctx.fillStyle = selectedChar.color; ctx.fillRect(g.player.x, g.player.y, 32, 32);
        ctx.fillStyle = 'white';
        const faceX = g.player.facing.x || 0; const faceY = g.player.facing.y || 0;
        ctx.fillRect(g.player.x + 10 + faceX * 6, g.player.y + 8 + faceY * 6, 4, 4);
        ctx.fillRect(g.player.x + 20 + faceX * 6, g.player.y + 8 + faceY * 6, 4, 4);
    }

    // Projectiles & Shockwaves & Particles
    g.projectiles.forEach(p => { 
        ctx.fillStyle = '#d2691e'; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3e2723'; 
        ctx.beginPath(); ctx.arc(p.x-2, p.y-1, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x+2, p.y+2, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x+1, p.y-3, 1.5, 0, Math.PI*2); ctx.fill();
    });
    g.shockwaves.forEach(s => {
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(142, 68, 173, ${s.alpha})`; ctx.fill();
        ctx.strokeStyle = `rgba(255, 255, 255, ${s.alpha})`; ctx.lineWidth = 2; ctx.stroke();
    });
    g.particles.forEach(p => { ctx.fillStyle = p.color; ctx.globalAlpha = p.life / 20; ctx.fillRect(p.x, p.y, 4, 4); ctx.globalAlpha = 1.0; });

    if (g.building) drawMiniMap(ctx, g.building, activeRoomId);
  };

  const drawMiniMap = (ctx, building, activeRoomId) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    building.rooms.forEach(r => { if(r.x < minX) minX = r.x; if(r.x > maxX) maxX = r.x; if(r.y < minY) minY = r.y; if(r.y > maxY) maxY = r.y; });
    const mapScale = 16; const gap = 8; const padding = 10;
    const mapW = (maxX - minX + 1) * (mapScale + gap) - gap; const mapH = (maxY - minY + 1) * (mapScale + gap) - gap;
    const startX = ctx.canvas.width - mapW - 20 - padding * 2; const startY = 20;
    ctx.fillStyle = COLORS.minimapBg; ctx.fillRect(startX, startY, mapW + padding * 2, mapH + padding * 2);
    const getPos = (rx, ry) => ({ x: startX + padding + (rx - minX) * (mapScale + gap), y: startY + padding + (ry - minY) * (mapScale + gap) });
    ctx.strokeStyle = '#666'; ctx.lineWidth = 2;
    building.rooms.forEach(r => {
        const p1 = getPos(r.x, r.y); const center1 = { x: p1.x + mapScale/2, y: p1.y + mapScale/2 };
        Object.entries(r.doors).forEach(([dir, neighborId]) => {
            if (neighborId !== null) {
                const neighbor = building.rooms.find(n => n.id === neighborId);
                if (neighbor) {
                    const p2 = getPos(neighbor.x, neighbor.y);
                    ctx.beginPath(); ctx.moveTo(center1.x, center1.y); ctx.lineTo(p2.x + mapScale/2, p2.y + mapScale/2); ctx.stroke();
                }
            }
        });
    });
    building.rooms.forEach(r => {
        const p = getPos(r.x, r.y);
        if (r.id === activeRoomId) ctx.fillStyle = COLORS.minimapActive;
        else if (r.explored) ctx.fillStyle = COLORS.minimapExplored;
        else ctx.fillStyle = COLORS.minimapRoom;
        ctx.fillRect(p.x, p.y, mapScale, mapScale);
        if (r.type === 'boss') { ctx.strokeStyle = COLORS.minimapBoss; ctx.lineWidth = 2; ctx.strokeRect(p.x, p.y, mapScale, mapScale); }
        if (r.items && r.items.length > 0) { ctx.fillStyle = COLORS.minimapItem; ctx.beginPath(); ctx.arc(p.x + mapScale/2, p.y + mapScale/2, 3, 0, Math.PI*2); ctx.fill(); }
    });
  };

  const tick = useCallback((time) => {
    const dt = time - gameData.current.lastTime; gameData.current.lastTime = time; update(dt);
    const canvas = canvasRef.current;
    if (canvas) {
        const g = gameData.current;
        const currentRoom = g.building ? g.building.rooms.find(r => r.id === activeRoomId) : null;
        if (currentRoom) {
            if (canvas.width !== currentRoom.width * TILE_SIZE || canvas.height !== currentRoom.height * TILE_SIZE) {
                canvas.width = currentRoom.width * TILE_SIZE; canvas.height = currentRoom.height * TILE_SIZE;
            }
        }
        const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; draw(ctx);
    }
    requestRef.current = requestAnimationFrame(tick);
  }, [gameState, activeRoomId, currentBuildingId]); 

  useEffect(() => { requestRef.current = requestAnimationFrame(tick); return () => cancelAnimationFrame(requestRef.current); }, [tick]);

  useEffect(() => {
    const handleKeyDown = (e) => {
        const k = e.key;
        if (k === 'ArrowUp' || k === 'w') gameData.current.input.y = -1;
        if (k === 'ArrowDown' || k === 's') gameData.current.input.y = 1;
        if (k === 'ArrowLeft' || k === 'a') gameData.current.input.x = -1;
        if (k === 'ArrowRight' || k === 'd') gameData.current.input.x = 1;
        if (k === ' ' || k === 'Enter') gameData.current.input.fire = true;
        if (k === 'Shift' || k === 'b' || k === 'e') gameData.current.input.bomb = true;
    };
    const handleKeyUp = (e) => {
        const k = e.key;
        if ((k === 'ArrowUp' || k === 'w') && gameData.current.input.y === -1) gameData.current.input.y = 0;
        if ((k === 'ArrowDown' || k === 's') && gameData.current.input.y === 1) gameData.current.input.y = 0;
        if ((k === 'ArrowLeft' || k === 'a') && gameData.current.input.x === -1) gameData.current.input.x = 0;
        if ((k === 'ArrowRight' || k === 'd') && gameData.current.input.x === 1) gameData.current.input.x = 0;
        if (k === ' ' || k === 'Enter') gameData.current.input.fire = false;
        if (k === 'Shift' || k === 'b' || k === 'e') gameData.current.input.bomb = false;
    };
    window.addEventListener('keydown', handleKeyDown); window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, []);

  const handleJoystick = ({ x, y }) => { const tx = Math.abs(x) < 0.1 ? 0 : x; const ty = Math.abs(y) < 0.1 ? 0 : y; gameData.current.input.x = tx; gameData.current.input.y = ty; };
  const handleFireBtn = (active) => { gameData.current.input.fire = active; };
  const handleBombBtn = (active) => { gameData.current.input.bomb = active; };

  // --- ENDING SEQUENCE ---
  const getEndingContent = () => {
      const hiddenCleared = worldMap.find(b => b.id === HIDDEN_BUILDING_ID)?.cleared;
      const allFiles = playerStats.files >= 5;
      const hasKey = playerStats.keys > 0;

      // Page 1: Base Escape (Always shown first)
      if (endingPage === 0) {
          return {
              title: hasKey ? "Escaped Together" : "Escaped Alone",
              text: hasKey 
                  ? "You find your friend on the dockyard, you have the key, and you released your friends. Together, you successfully escaped." 
                  : "You find the boat to leave the island, your friend is locked in a cage on the dockyard. Your friend tried to make noise to attract the focus of the guards and you successfully escaped.",
              next: hiddenCleared
          };
      }
      
      // Page 2: Hidden Level (Only if hidden cleared)
      if (endingPage === 1 && hiddenCleared) {
          return {
              title: "Savior",
              text: "By clearing the hidden dungeon, you released all the trapped kids!",
              next: true // Go to page 3 logic
          };
      }

      // Page 3: Truth (Always shown)
      // Note: Logic allows skipping Page 2 if not cleared
      if ((endingPage === 2 && hiddenCleared) || (endingPage === 1 && !hiddenCleared)) {
          return {
              title: allFiles ? "Truth Exposed" : "Island Remains",
              text: allFiles
                  ? "With the collected files, you exposed the island to the media. Police raid incoming!"
                  : "You survived, but without evidence, the island's dark experiments continue.",
              next: hiddenCleared && allFiles // Only go to page 4 if BOTH conditions met
          };
      }

      // Page 4: Nobel Prize (Ultimate ending)
      if (hiddenCleared && allFiles) {
          return {
              title: "Nobel Peace Prize",
              text: "Your extraordinary bravery and complete exposure of the operation earned you the Nobel Peace Prize!",
              next: false
          };
      }

      return null;
  };

  const renderEnding = () => {
      const content = getEndingContent();
      if (!content) return null;

      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 z-50 text-center px-8">
            <h2 className="text-5xl font-bold text-yellow-400 mb-6">{content.title}</h2>
            <p className="text-2xl text-white mb-12 max-w-3xl leading-relaxed">{content.text}</p>
            <button 
                onClick={() => {
                    if (content.next) {
                        setEndingPage(prev => prev + (endingPage === 1 && !worldMap.find(b => b.id === HIDDEN_BUILDING_ID)?.cleared ? 2 : 1)); // Skip p2 if needed logic is handled in getEndingContent roughly but state needs increment
                        // Actually easier: just increment, let getEndingContent handle the logic mapping based on current index?
                        // My getEndingContent logic uses specific indices.
                        // Let's simple increment state, but handle skipping inside the render logic call
                        let nextVal = endingPage + 1;
                        const hiddenCleared = worldMap.find(b => b.id === HIDDEN_BUILDING_ID)?.cleared;
                        if (endingPage === 0 && !hiddenCleared) nextVal = 2; // Skip to page 3 (Truth) logic index
                        setEndingPage(nextVal);
                    } else {
                        setGameState('START');
                    }
                }}
                className="px-8 py-4 bg-white text-black font-bold rounded-full hover:bg-gray-200 flex items-center gap-2"
            >
                {content.next ? <><ArrowRight /> Next</> : <><RotateCcw /> Return to Title</>}
            </button>
        </div>
      );
  };

  return (
    <div className="w-full h-screen bg-slate-900 overflow-hidden relative select-none touch-none text-white font-sans">
      <canvas ref={canvasRef} className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black shadow-2xl" style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', imageRendering: 'pixelated' }} />
      
      {gameState === 'START' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-cover bg-center z-50 text-center px-4" 
             style={{
                 backgroundImage: assets.current['bg_start'] ? `url(${assets.current['bg_start'].toDataURL()})` : 'none', 
                 backgroundColor: '#2c3e50'
             }}>
            <div className="bg-black/60 p-8 rounded-2xl backdrop-blur-md max-w-2xl w-full">
                <h1 className="text-5xl md:text-7xl font-black mb-6 text-yellow-400 tracking-wider drop-shadow-lg">ESCAPE THE ISLAND</h1>
                {highScore > 0 && <div className="flex items-center justify-center gap-2 text-yellow-200 mb-8 text-xl font-bold bg-white/10 py-2 rounded-lg"><Trophy className="text-yellow-400" /> High Score: {highScore}</div>}
                <div className="bg-gray-800/80 p-6 rounded-xl text-left mb-8 border border-gray-600">
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2"><Info size={20} /> How to Play</h3>
                    <ul className="space-y-2 text-gray-300 text-sm">
                        <li>• <strong>Move:</strong> WASD / Arrow Keys (Desktop) or Left Joystick (Mobile)</li>
                        <li>• <strong>Shoot:</strong> Spacebar / Enter (Desktop) or Right Button (Mobile)</li>
                        <li>• <strong>Bomb:</strong> Shift / B (Desktop) or Top Button (Mobile). Clears room!</li>
                        <li>• <strong>Goal:</strong> Find the exit door in each building. Survive 6 levels.</li>
                    </ul>
                </div>
                <button onClick={initGameSession} className="w-full px-8 py-5 bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-black font-black text-2xl rounded-xl shadow-lg transform transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-3">
                    <Play fill="black" size={32} /> START NEW GAME
                </button>
            </div>
        </div>
      )}

      {/* --- HUD --- */}
      {gameState === 'PLAYING' && (
        <>
            <div className="absolute top-4 left-4 flex flex-col gap-2">
                <div className="flex gap-1">
                    {Array.from({length: playerStats.maxHp}).map((_, i) => (
                        <Pizza key={i} size={24} fill={i < playerStats.hp ? COLORS.pizza : "none"} className={i < playerStats.hp ? "text-orange-500" : "text-gray-600"} />
                    ))}
                </div>
                <div className="flex gap-1">
                    {Array.from({length: playerStats.maxMp}).map((_, i) => (
                        <Grape key={i} size={24} fill={i < playerStats.mp ? COLORS.soda : "none"} className={i < playerStats.mp ? "text-purple-500" : "text-gray-600"} />
                    ))}
                </div>
            </div>
            <div className="absolute top-4 right-4 text-xl font-bold text-yellow-400">Score: {playerStats.score}</div>
            <div className="absolute bottom-4 left-4 flex flex-col gap-1 bg-black/50 p-2 rounded text-white text-xs">
                <div className="flex items-center gap-1"><Wind size={14} /> Speed: {playerStats.speed}</div>
                <div className="flex items-center gap-1"><Briefcase size={14} /> Power: {playerStats.damage}</div>
                <div className="flex items-center gap-1"><Key size={14} /> Keys: {playerStats.keys}</div>
                <div className="flex items-center gap-1"><FileText size={14} /> Files: {playerStats.files}/5</div>
            </div>
            <div className="lg:hidden">
                <VirtualJoystick onMove={handleJoystick} />
                <div className="absolute bottom-10 right-10 flex gap-4">
                    <button className={`w-20 h-20 rounded-full border-4 flex items-center justify-center backdrop-blur-sm ${playerStats.mp >= BOMB_COST ? 'bg-purple-500/50 border-purple-400 active:bg-purple-500/80' : 'bg-gray-700/50 border-gray-600 grayscale'}`} onTouchStart={() => handleBombBtn(true)} onTouchEnd={() => handleBombBtn(false)} onMouseDown={() => handleBombBtn(true)} onMouseUp={() => handleBombBtn(false)}><Bomb size={32} /></button>
                    <button className="w-24 h-24 rounded-full bg-red-500/50 border-4 border-red-400 active:bg-red-500/80 flex items-center justify-center backdrop-blur-sm" onTouchStart={() => handleFireBtn(true)} onTouchEnd={() => handleFireBtn(false)} onMouseDown={() => handleFireBtn(true)} onMouseUp={() => handleFireBtn(false)}><Crosshair size={40} /></button>
                </div>
            </div>
            <div className="hidden lg:block absolute bottom-4 left-1/2 -translate-x-1/2 text-gray-400 text-sm">WASD to Move | Space to Fire | B to Bomb (Costs {BOMB_COST} MP)</div>
        </>
      )}

      {/* --- CHARACTER SELECT --- */}
      {gameState === 'CHAR_SELECT' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/95 z-50">
            <h2 className="text-4xl font-bold mb-8 text-white">Select Your Hero</h2>
            <div className="flex flex-col md:flex-row gap-6 mb-12">
                {CHARACTERS.map(char => (
                    <div key={char.id} onClick={() => setSelectedChar(char)} className={`p-6 rounded-xl border-2 cursor-pointer transition-all ${selectedChar.id === char.id ? 'border-yellow-400 bg-white/10 scale-105' : 'border-gray-600 bg-white/5 hover:bg-white/10'}`}>
                        <div className="flex items-center gap-3 mb-2"><div className="w-8 h-8 rounded" style={{background: char.color}}></div><h3 className="text-xl font-bold text-white">{char.name}</h3></div>
                        <p className="text-gray-400 text-sm mb-4">{char.description}</p>
                        <div className="space-y-2 text-xs text-gray-300">
                            <div className="flex justify-between"><span>Speed</span> <div className="w-20 bg-gray-700 h-2 rounded"><div className="bg-green-500 h-full rounded" style={{width: `${(char.speed/6)*100}%`}}></div></div></div>
                            <div className="flex justify-between"><span>Health</span> <div className="w-20 bg-gray-700 h-2 rounded"><div className="bg-red-500 h-full rounded" style={{width: `${(char.maxHp/6)*100}%`}}></div></div></div>
                            <div className="flex justify-between"><span>Magic</span> <div className="w-20 bg-gray-700 h-2 rounded"><div className="bg-purple-500 h-full rounded" style={{width: `${(char.maxMp/6)*100}%`}}></div></div></div>
                        </div>
                    </div>
                ))}
            </div>
            <button onClick={startGame} className="px-8 py-4 bg-green-600 hover:bg-green-500 text-white font-bold text-xl rounded-full shadow-lg flex items-center gap-2 transition-transform hover:scale-110"><Play fill="white" /> ENTER ISLAND</button>
        </div>
      )}

      {/* --- MAP --- */}
      {gameState === 'MAP' && (
        <div className="absolute inset-0 bg-slate-800 z-40 overflow-hidden flex flex-col">
             <div className="w-full p-4 bg-black/50 backdrop-blur text-center shrink-0 z-10">
                 <h2 className="text-2xl font-bold text-white">Island Map</h2>
                 <p className="text-gray-400">Select the next building to explore</p>
             </div>
             
             {/* Render Columns */}
             <div className="flex-1 overflow-x-auto flex items-center justify-start px-20 gap-16">
                 {(() => {
                     // Group buildings by column
                     const minCol = Math.min(...worldMap.map(b => b.column));
                     const maxCol = Math.max(...worldMap.map(b => b.column));
                     const cols = [];
                     // Include hidden column (-1) if it exists
                     for(let i=minCol; i<=maxCol; i++) cols.push(worldMap.filter(b => b.column === i));
                     
                     return cols.map((colBuildings, colIdxOffset) => {
                         const colIdx = minCol + colIdxOffset;
                         return (
                         <div key={colIdx} className="flex flex-col items-center gap-8 relative">
                             {/* Connector Line to Next Column */}
                             {colIdx >= 0 && colIdx < maxCol && (
                                 <div className="absolute top-1/2 left-full w-16 h-1 bg-gray-600 -translate-y-1/2 z-0" />
                             )}
                             {/* Hidden Column Connector (Dashed line to Start) */}
                             {colIdx === -1 && (
                                 <div className="absolute top-1/2 left-full w-16 h-1 border-t-4 border-dashed border-gray-700 -translate-y-1/2 z-0" />
                             )}
                             
                             {colBuildings.map(node => {
                                 // Don't render hidden nodes if they are still hidden
                                 if (node.hidden) return null;

                                 return (
                                 <div key={node.id} className="relative z-10 flex flex-col items-center">
                                     <button
                                        disabled={node.locked}
                                        onClick={() => enterBuilding(node.id)}
                                        className={`w-24 h-24 rounded-full border-4 flex items-center justify-center transition-all relative
                                            ${node.cleared ? 'bg-green-600 border-green-400 ring-4 ring-green-900/50' : 
                                              node.locked ? 'bg-gray-700 border-gray-600 grayscale cursor-not-allowed opacity-50' : 
                                              'bg-blue-600 border-blue-400 animate-pulse cursor-pointer shadow-blue-500/50 shadow-lg hover:scale-110'}`}
                                     >
                                         {node.id === HIDDEN_BUILDING_ID ? <Lock size={32} /> : (node.cleared ? <Zap size={40} /> : <MapIcon size={32} />)}
                                         {/* Checkmark for re-entry clarity */}
                                         {node.cleared && <div className="absolute -bottom-2 -right-2 bg-green-400 text-black rounded-full p-1 border-2 border-white"><RotateCcw size={14} /></div>}
                                     </button>
                                     <div className="mt-2 bg-black/70 px-3 py-1 rounded text-center backdrop-blur-sm border border-gray-700">
                                         <div className="text-white font-bold">{node.id === HIDDEN_BUILDING_ID ? "???" : `Lvl ${node.level}`}</div>
                                         <div className="text-[10px] text-gray-300 uppercase tracking-widest">{node.theme.replace('_', ' ')}</div>
                                     </div>
                                 </div>
                                )
                             })}
                         </div>
                     )});
                 })()}
             </div>
        </div>
      )}

      {/* --- GAME OVER --- */}
      {(gameState === 'GAMEOVER') && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-red-900/90 backdrop-blur">
            <h2 className="text-6xl font-black text-white mb-4">GAME OVER</h2>
            <p className="text-xl mb-8">You fell in Building {currentBuildingId + 1}</p>
            <div className="text-2xl mb-8 font-mono bg-black/30 px-6 py-2 rounded">Final Score: {playerStats.score}</div>
            <button onClick={() => setGameState('START')} className="px-8 py-3 bg-white text-black font-bold rounded-full hover:bg-gray-200 flex items-center gap-2">
                <RotateCcw /> Return to Title
            </button>
        </div>
      )}

      {/* --- ENDING SEQUENCE --- */}
      {gameState === 'ENDING' && renderEnding()}

      {/* --- MESSAGE OVERLAY --- */}
      {gameState === 'MESSAGE' && messageData && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-50 text-center px-8">
            <h2 className="text-4xl font-bold text-yellow-400 mb-6">{messageData.title}</h2>
            <p className="text-2xl text-white mb-12 max-w-3xl leading-relaxed">{messageData.text}</p>
            <button 
                onClick={() => setGameState(messageData.nextState)}
                className="px-8 py-4 bg-white text-black font-bold rounded-full hover:bg-gray-200 flex items-center gap-2"
            >
                <ArrowRight /> Continue
            </button>
        </div>
      )}
    </div>
  );
}