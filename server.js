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
        // Leave existing room if any
        if (currentRoom) leaveCurrentRoom(socket);

        socket.join(roomName);
        currentRoom = roomName;
        if (!rooms[currentRoom]) rooms[currentRoom] = {};
        
        rooms[currentRoom][socket.id] = {
            id: socket.id,
            position: { x: 0, y: 0, z: 0 }, // Base of the player
            rotation: { y: 0 },
            color: Math.floor(Math.random() * 16777215) 
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

    // Custom leave event for the Pause Menu
    socket.on('leaveRoom', () => {
        leaveCurrentRoom(socket);
        currentRoom = null;
    });

    socket.on('disconnect', () => {
        leaveCurrentRoom(socket);
    });

    // Helper function to cleanly remove a player from a room
    function leaveCurrentRoom(sock) {
        if (currentRoom && rooms[currentRoom]) {
            sock.leave(currentRoom);
            delete rooms[currentRoom][sock.id];
            io.to(currentRoom).emit('playerDisconnected', sock.id);
            
            if (Object.keys(rooms[currentRoom]).length === 0) {
                delete rooms[currentRoom];
            }
            broadcastRoomList();
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running smoothly on port ${PORT}`));
