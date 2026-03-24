const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// State management for rooms and players
const rooms = {};

// Helper function to broadcast the list of active rooms to the main menu
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

    // Send the room list to newly connected users
    broadcastRoomList();

    socket.on('joinRoom', (roomName) => {
        // Clean up previous room if switching
        if (currentRoom) leaveCurrentRoom(socket);

        socket.join(roomName);
        currentRoom = roomName;
        
        if (!rooms[currentRoom]) rooms[currentRoom] = {};
        
        // Initialize player data
        rooms[currentRoom][socket.id] = {
            id: socket.id,
            position: { x: 0, y: 0, z: 0 },
            rotation: { y: 0 },
            color: Math.floor(Math.random() * 16777215), // Random hex color
            health: 100
        };

        // Send current room state to the new player
        socket.emit('currentPlayers', rooms[currentRoom]);
        // Notify others in the room
        socket.to(currentRoom).emit('newPlayer', rooms[currentRoom][socket.id]);
        
        console.log(`[+] ${socket.id} joined ${roomName}`);
        broadcastRoomList();
    });

    socket.on('playerMovement', (movementData) => {
        if (currentRoom && rooms[currentRoom][socket.id]) {
            rooms[currentRoom][socket.id].position = movementData.position;
            rooms[currentRoom][socket.id].rotation = movementData.rotation;
            
            // Broadcast movement to all OTHER players in the room
            socket.to(currentRoom).emit('playerMoved', rooms[currentRoom][socket.id]);
        }
    });

    // --- Combat System ---
    socket.on('playerShot', (data) => {
        // Broadcast the tracer/laser visual to everyone else
        socket.to(currentRoom).emit('drawLaser', { 
            fromId: socket.id, 
            toPosition: data.hitPoint 
        });
    });

    socket.on('registerHit', (data) => {
        if (currentRoom && rooms[currentRoom][data.targetId]) {
            const target = rooms[currentRoom][data.targetId];
            
            // Deduct health based on the weapon's damage, defaulting to 25
            target.health -= (data.damage || 25); 

            if (target.health <= 0) {
                // Player died
                target.health = 100; // Reset health for respawn
                target.position = { x: 0, y: 0, z: 0 }; // Reset position to center
                
                // Notify the victim
                io.to(data.targetId).emit('youDied');
                // Notify the room that the player respawned
                io.to(currentRoom).emit('playerRespawned', target);
            } else {
                // Just update health UI for everyone
                io.to(currentRoom).emit('updateHealth', { 
                    id: data.targetId, 
                    health: target.health 
                });
            }
        }
    });

    // --- Room Management ---
    socket.on('leaveRoom', () => {
        leaveCurrentRoom(socket);
        currentRoom = null;
    });

    socket.on('disconnect', () => {
        leaveCurrentRoom(socket);
        console.log(`[-] ${socket.id} disconnected`);
    });

    // Helper to cleanly remove a player and clean up empty rooms
    function leaveCurrentRoom(sock) {
        if (currentRoom && rooms[currentRoom]) {
            sock.leave(currentRoom);
            delete rooms[currentRoom][sock.id];
            
            // Tell others the player left
            io.to(currentRoom).emit('playerDisconnected', sock.id);
            
            // Delete the room if it's empty
            if (Object.keys(rooms[currentRoom]).length === 0) {
                delete rooms[currentRoom];
            }
            broadcastRoomList();
        }
    }
});

// Use the dynamic port for Render, or 3000 for local testing
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server active on port ${PORT}`));
