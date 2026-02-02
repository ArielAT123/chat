const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const path = require('path');

const app = express();
const httpServer = createServer(app);

// Configurar CORS
app.use(cors());

// Servir archivos estáticos del frontend (compilado)
app.use(express.static(path.join(__dirname, '../cliente/dist')));

// Configurar Socket.io con CORS
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173", // URL de Vite o variable de entorno
    methods: ["GET", "POST"]
  }
});

// Almacenar información de las salas
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('✅ Usuario conectado:', socket.id);

  // Unirse a una sala
  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);
    socket.username = username;
    socket.roomId = roomId;

    // Agregar usuario a la sala
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);

    console.log(`👤 ${username} se unió a la sala: ${roomId}`);

    // Notificar a todos en la sala
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      username: username
    });

    // Enviar lista de usuarios existentes al nuevo usuario
    const usersInRoom = Array.from(rooms.get(roomId))
      .filter(id => id !== socket.id)
      .map(id => {
        const userSocket = io.sockets.sockets.get(id);
        return {
          id,
          username: userSocket ? userSocket.username : 'Unknown'
        };
      });

    socket.emit('existing-users', usersInRoom);

    // Broadcast a la sala cuántos usuarios hay
    const userCount = rooms.get(roomId).size;
    io.to(roomId).emit('room-users-update', {
      count: userCount,
      users: Array.from(rooms.get(roomId))
    });
  });

  // Señalización WebRTC - Enviar oferta
  socket.on('offer', ({ offer, to }) => {
    console.log(`📤 Enviando oferta de ${socket.id} a ${to}`);
    socket.to(to).emit('offer', {
      offer: offer,
      from: socket.id,
      username: socket.username
    });
  });

  // Señalización WebRTC - Enviar respuesta
  socket.on('answer', ({ answer, to }) => {
    console.log(`📥 Enviando respuesta de ${socket.id} a ${to}`);
    socket.to(to).emit('answer', {
      answer: answer,
      from: socket.id
    });
  });

  // Señalización WebRTC - Intercambiar candidatos ICE
  socket.on('ice-candidate', ({ candidate, to }) => {
    socket.to(to).emit('ice-candidate', {
      candidate: candidate,
      from: socket.id
    });
  });

  // Manejar desconexión
  socket.on('disconnect', () => {
    console.log('❌ Usuario desconectado:', socket.id);

    if (socket.roomId && rooms.has(socket.roomId)) {
      const room = rooms.get(socket.roomId);
      room.delete(socket.id);

      // Notificar a otros usuarios
      socket.to(socket.roomId).emit('user-left', {
        userId: socket.id,
        username: socket.username
      });

      // Actualizar contador de usuarios
      const userCount = room.size;
      io.to(socket.roomId).emit('room-users-update', {
        count: userCount,
        users: Array.from(room)
      });

      // Eliminar sala si está vacía
      if (room.size === 0) {
        rooms.delete(socket.roomId);
        console.log(`🗑️ Sala ${socket.roomId} eliminada (vacía)`);
      }
    }
  });
});

// Endpoint para obtener usuarios de una sala
app.get('/api/rooms/:roomId/users', (req, res) => {
  const { roomId } = req.params;
  const roomUsers = rooms.get(roomId);

  if (!roomUsers) {
    return res.json([]);
  }

  const usersList = [];
  const sockets = io.sockets.sockets;

  for (const socketId of roomUsers) {
    const socket = sockets.get(socketId);
    if (socket) {
      usersList.push({
        id: socketId,
        username: socket.username || 'Anónimo'
      });
    }
  }

  res.json(usersList);
});

// Cualquier otra ruta envía al index.html (para SPA)
// Cualquier otra ruta envía al index.html (para SPA)
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, '../cliente/dist/index.html'));
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});