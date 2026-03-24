const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// Rooms now store { mapId, players: {} }
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

    broadcastRoomList();

    // Joining now accepts an object with the mapId and skin
    socket.on('joinRoom', (data) => {
        if (currentRoom) leaveCurrentRoom(socket);

        const roomName = data.roomName;
        socket.join(roomName);
        currentRoom = roomName;
        
        // If room doesn't exist, create it and set the map
        if (!rooms[currentRoom]) {
            rooms[currentRoom] = {
                mapId: data.mapId || 1,
                players: {}
            };
        }
        
        rooms[currentRoom].players[socket.id] = {
            id: socket.id,
            position: { x: 0, y: 0, z: 0 },
            rotation: { y: 0 },
            color: Math.floor(Math.random() * 16777215), 
            health: 100,
            skin: data.skin || 'default' // Store the chosen skin
        };

        // Send the current room state (including the map) to the new player
        socket.emit('roomState', {
            mapId: rooms[currentRoom].mapId,
            players: rooms[currentRoom].players
        });
        
        socket.to(currentRoom).emit('newPlayer', rooms[currentRoom].players[socket.id]);
        
        console.log(`[+] ${socket.id} joined ${roomName} (Map ${rooms[currentRoom].mapId}, Skin: ${data.skin})`);
        broadcastRoomList();
    });

    socket.on('playerMovement', (movementData) => {
        if (currentRoom && rooms[currentRoom].players[socket.id]) {
            rooms[currentRoom].players[socket.id].position = movementData.position;
            rooms[currentRoom].players[socket.id].rotation = movementData.rotation;
            socket.to(currentRoom).emit('playerMoved', rooms[currentRoom].players[socket.id]);
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
            target.health -= (data.damage || 25); 

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
