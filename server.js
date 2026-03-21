const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function broadcastRoomList() {
    const activeRooms = Object.keys(rooms).map(roomName => {
        return { name: roomName, players: Object.keys(rooms[roomName]).length };
    });
    io.emit('availableRooms', activeRooms);
}

io.on('connection', (socket) => {
    let currentRoom = null;
    broadcastRoomList();

    socket.on('joinRoom', (roomName) => {
        if (currentRoom) leaveCurrentRoom(socket);

        socket.join(roomName);
        currentRoom = roomName;
        if (!rooms[currentRoom]) rooms[currentRoom] = {};
        
        rooms[currentRoom][socket.id] = {
            id: socket.id,
            position: { x: 0, y: 0, z: 0 },
            rotation: { y: 0 },
            color: Math.floor(Math.random() * 16777215),
            health: 100 // New: Track health
        };

        socket.emit('currentPlayers', rooms[currentRoom]);
        socket.to(currentRoom).emit('newPlayer', rooms[currentRoom][socket.id]);
        broadcastRoomList();
    });

    socket.on('playerMovement', (movementData) => {
        if (currentRoom && rooms[currentRoom][socket.id]) {
            rooms[currentRoom][socket.id].position = movementData.position;
            rooms[currentRoom][socket.id].rotation = movementData.rotation;
            socket.to(currentRoom).emit('playerMoved', rooms[currentRoom][socket.id]);
        }
    });

    // --- NEW: Combat System ---
    socket.on('playerShot', (data) => {
        // Broadcast the laser visual to everyone else
        socket.to(currentRoom).emit('drawLaser', { fromId: socket.id, toPosition: data.hitPoint });
    });

    socket.on('registerHit', (data) => {
        if (currentRoom && rooms[currentRoom][data.targetId]) {
            const target = rooms[currentRoom][data.targetId];
            target.health -= 25; // 25 Damage per shot

            if (target.health <= 0) {
                // Player died
                target.health = 100; // Reset health
                target.position = { x: 0, y: 0, z: 0 }; // Send back to spawn
                
                // Tell the specific player they died
                io.to(data.targetId).emit('youDied');
                // Tell everyone to update this player's state
                io.to(currentRoom).emit('playerRespawned', target);
            } else {
                // Just update health
                io.to(currentRoom).emit('updateHealth', { id: data.targetId, health: target.health });
            }
        }
    });

    socket.on('leaveRoom', () => { leaveCurrentRoom(socket); currentRoom = null; });
    socket.on('disconnect', () => { leaveCurrentRoom(socket); });

    function leaveCurrentRoom(sock) {
        if (currentRoom && rooms[currentRoom]) {
            sock.leave(currentRoom);
            delete rooms[currentRoom][sock.id];
            io.to(currentRoom).emit('playerDisconnected', sock.id);
            if (Object.keys(rooms[currentRoom]).length === 0) delete rooms[currentRoom];
            broadcastRoomList();
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server active on port ${PORT}`));
