const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// State management
const rooms = {};

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('joinRoom', (roomName) => {
        socket.join(roomName);
        currentRoom = roomName;
        
        if (!rooms[currentRoom]) rooms[currentRoom] = {};
        
        // Initialize player with position, rotation, and a random color
        rooms[currentRoom][socket.id] = {
            id: socket.id,
            position: { x: 0, y: 1, z: 0 },
            rotation: { y: 0 },
            color: Math.floor(Math.random() * 16777215) 
        };

        // Send the new player the current room state
        socket.emit('currentPlayers', rooms[currentRoom]);
        
        // Tell everyone else in the room a new player joined
        socket.to(currentRoom).emit('newPlayer', rooms[currentRoom][socket.id]);
        
        console.log(`[+] ${socket.id} joined ${roomName}`);
    });

    // Handle movement and rotation updates
    socket.on('playerMovement', (movementData) => {
        if (currentRoom && rooms[currentRoom][socket.id]) {
            rooms[currentRoom][socket.id].position = movementData.position;
            rooms[currentRoom][socket.id].rotation = movementData.rotation;
            
            // Broadcast to all OTHER players in the room
            socket.to(currentRoom).emit('playerMoved', rooms[currentRoom][socket.id]);
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            delete rooms[currentRoom][socket.id];
            io.to(currentRoom).emit('playerDisconnected', socket.id);
            console.log(`[-] ${socket.id} disconnected`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running smoothly on port ${PORT}`));
