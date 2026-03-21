const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Helper to send the current active rooms to clients
function broadcastRoomList() {
    const activeRooms = Object.keys(rooms).map(roomName => {
        return {
            name: roomName,
            players: Object.keys(rooms[roomName]).length
        };
    });
    io.emit('availableRooms', activeRooms);
}

io.on('connection', (socket) => {
    let currentRoom = null;

    // Send the room list immediately when a user connects
    broadcastRoomList();

    socket.on('joinRoom', (roomName) => {
        // Leave previous room if any (safety catch)
        if (currentRoom) {
            socket.leave(currentRoom);
            if (rooms[currentRoom]) delete rooms[currentRoom][socket.id];
        }

        socket.join(roomName);
        currentRoom = roomName;
        
        if (!rooms[currentRoom]) rooms[currentRoom] = {};
        
        rooms[currentRoom][socket.id] = {
            id: socket.id,
            position: { x: 0, y: 1, z: 0 },
            rotation: { y: 0 },
            color: Math.floor(Math.random() * 16777215) 
        };

        socket.emit('currentPlayers', rooms[currentRoom]);
        socket.to(currentRoom).emit('newPlayer', rooms[currentRoom][socket.id]);
        
        console.log(`[+] ${socket.id} joined ${roomName}`);
        
        // Update everyone's server list
        broadcastRoomList();
    });

    socket.on('playerMovement', (movementData) => {
        if (currentRoom && rooms[currentRoom][socket.id]) {
            rooms[currentRoom][socket.id].position = movementData.position;
            rooms[currentRoom][socket.id].rotation = movementData.rotation;
            socket.to(currentRoom).emit('playerMoved', rooms[currentRoom][socket.id]);
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            delete rooms[currentRoom][socket.id];
            io.to(currentRoom).emit('playerDisconnected', socket.id);
            
            // Clean up empty rooms
            if (Object.keys(rooms[currentRoom]).length === 0) {
                delete rooms[currentRoom];
            }
            console.log(`[-] ${socket.id} disconnected`);
            broadcastRoomList();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running smoothly on port ${PORT}`));
