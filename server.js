const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Serve the frontend files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('joinRoom', (roomName) => {
        socket.join(roomName);
        currentRoom = roomName;
        
        if (!rooms[currentRoom]) rooms[currentRoom] = {};
        
        // Initialize player data
        rooms[currentRoom][socket.id] = {
            position: { x: 0, y: 1.6, z: 0 },
            color: Math.random() * 0xffffff
        };

        console.log(`User ${socket.id} joined room: ${roomName}`);
    });

    socket.on('move', (data) => {
        if (currentRoom && rooms[currentRoom][socket.id]) {
            rooms[currentRoom][socket.id].position = data;
            // Send updates to everyone else in the room
            socket.to(currentRoom).emit('updatePlayers', rooms[currentRoom]);
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            delete rooms[currentRoom][socket.id];
            io.to(currentRoom).emit('updatePlayers', rooms[currentRoom]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server active on port ${PORT}`));