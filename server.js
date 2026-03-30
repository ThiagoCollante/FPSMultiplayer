const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories exist
const mapsDir = path.join(__dirname, 'maps');
if (!fs.existsSync(mapsDir)) {
    fs.mkdirSync(mapsDir);
}

const mapObjsDir = path.join(__dirname, 'public', 'assets', 'mapobjs');
if (!fs.existsSync(mapObjsDir)) {
    fs.mkdirSync(mapObjsDir, { recursive: true });
}

// Dynamically read the maps folder
function getAvailableMaps() {
    const maps = [
        { id: '1', name: 'Map 1: Arena' },
        { id: '2', name: 'Map 2: Warehouse' },
        { id: '3', name: 'Map 3: Labyrinth' }
    ];
    
    try {
        const files = fs.readdirSync(mapsDir);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                maps.push({ id: file, name: `Custom: ${file.replace('.json', '')}` });
            }
        });
    } catch(err) {
        console.error("Error reading maps directory", err);
    }
    return maps;
}

// Dynamically read the mapobjs folder
function getAvailableMapObjects() {
    const objects = [];
    try {
        const files = fs.readdirSync(mapObjsDir);
        files.forEach(file => {
            if (file.endsWith('.glb') || file.endsWith('.gltf')) {
                // Capitalize the first letter and remove the extension for a clean UI name
                const rawName = file.replace(/\.(glb|gltf)$/, '');
                const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
                objects.push({ name: cleanName, file: file });
            }
        });
    } catch(err) {
        console.error("Error reading mapobjs directory", err);
    }
    return objects;
}

const rooms = {};

function broadcastRoomList() {
    const activeRooms = Object.keys(rooms).map(roomName => {
        return { 
            name: roomName, 
            players: Object.keys(rooms[roomName].players).length,
            mapId: rooms[roomName].mapId
        };
    });
    io.emit('availableRooms', activeRooms);
}

io.on('connection', (socket) => {
    let currentRoom = null;

    // Send dynamic data to the client on connection
    socket.emit('mapList', getAvailableMaps());
    socket.emit('mapObjectsList', getAvailableMapObjects());
    
    broadcastRoomList();

    socket.on('joinRoom', (data) => {
        if (currentRoom) leaveCurrentRoom(socket);

        const roomName = data.roomName;
        socket.join(roomName);
        currentRoom = roomName;
        
        if (!rooms[currentRoom]) {
            let initialObjects = {};
            
            if (data.mapId.toString().endsWith('.json')) {
                try {
                    const mapData = fs.readFileSync(path.join(mapsDir, data.mapId), 'utf-8');
                    initialObjects = JSON.parse(mapData);
                } catch(e) {
                    console.error(`Failed to load custom map: ${data.mapId}`, e);
                }
            }

            rooms[currentRoom] = {
                mapId: data.mapId || '1',
                players: {},
                customObjects: initialObjects 
            };
        }
        
        rooms[currentRoom].players[socket.id] = {
            id: socket.id,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0 },
            color: Math.floor(Math.random() * 16777215), 
            health: 100,
            weaponIndex: 0 
        };

        socket.emit('roomState', {
            mapId: rooms[currentRoom].mapId,
            players: rooms[currentRoom].players,
            customObjects: rooms[currentRoom].customObjects
        });
        
        socket.to(currentRoom).emit('newPlayer', rooms[currentRoom].players[socket.id]);
        console.log(`[+] ${socket.id} joined ${roomName} (Map ${rooms[currentRoom].mapId})`);
        broadcastRoomList();
    });

    socket.on('playerMovement', (movementData) => {
        if (currentRoom && rooms[currentRoom].players[socket.id]) {
            rooms[currentRoom].players[socket.id].position = movementData.position;
            rooms[currentRoom].players[socket.id].rotation = movementData.rotation;
            socket.to(currentRoom).emit('playerMoved', rooms[currentRoom].players[socket.id]);
        }
    });

    socket.on('changeWeapon', (weaponIndex) => {
        if (currentRoom && rooms[currentRoom].players[socket.id]) {
            rooms[currentRoom].players[socket.id].weaponIndex = weaponIndex;
            socket.to(currentRoom).emit('weaponChanged', { id: socket.id, weaponIndex: weaponIndex });
        }
    });

    socket.on('playerAction', (data) => {
        if (currentRoom) {
            socket.to(currentRoom).emit('playerAction', { id: socket.id, action: data.action });
        }
    });

    socket.on('playerShot', (data) => {
        socket.to(currentRoom).emit('drawLaser', { 
            fromId: socket.id, 
            toPosition: data.hitPoint 
        });
    });

    socket.on('registerHit', (data) => {
        if (currentRoom && rooms[currentRoom].players[data.targetId]) {
            const target = rooms[currentRoom].players[data.targetId];
            
            let finalDamage = data.damage || 25;
            if (data.isHeadshot) {
                finalDamage *= 2; 
            }

            target.health -= finalDamage; 

            if (target.health <= 0) {
                target.health = 100; 
                target.position = { x: 0, y: 0, z: 0 }; 
                io.to(data.targetId).emit('youDied');
                io.to(currentRoom).emit('playerRespawned', target);
            } else {
                io.to(currentRoom).emit('updateHealth', { id: data.targetId, health: target.health });
            }
        }
    });

    // Map Editor Events
    socket.on('spawnObject', (data) => {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].customObjects[data.id] = data;
            io.to(currentRoom).emit('objectSpawned', data);
        }
    });

    socket.on('deleteObject', (id) => {
        if (currentRoom && rooms[currentRoom] && rooms[currentRoom].customObjects[id]) {
            delete rooms[currentRoom].customObjects[id];
            io.to(currentRoom).emit('objectDeleted', id);
        }
    });

    socket.on('leaveRoom', () => { leaveCurrentRoom(socket); currentRoom = null; });
    socket.on('disconnect', () => { leaveCurrentRoom(socket); console.log(`[-] ${socket.id} disconnected`); });

    function leaveCurrentRoom(sock) {
        if (currentRoom && rooms[currentRoom]) {
            sock.leave(currentRoom);
            delete rooms[currentRoom].players[sock.id];
            io.to(currentRoom).emit('playerDisconnected', sock.id);
            
            if (Object.keys(rooms[currentRoom].players).length === 0) {
                delete rooms[currentRoom];
            }
            broadcastRoomList();
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server active on port ${PORT}`));
