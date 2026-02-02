import { io } from 'socket.io-client';

// Conectar al servidor
const socket = io('http://localhost:3000');

// Estado de la aplicación
const state = {
  localStream: null,
  peerConnections: new Map(), // Múltiples conexiones peer
  isMuted: false,
  currentRoom: null,
  username: null,
  remoteStreams: new Map()
};

// Configuración de WebRTC
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// Elementos del DOM
const elements = {
  roomId: document.getElementById('roomId'),
  username: document.getElementById('username'),
  joinBtn: document.getElementById('joinBtn'),
  muteBtn: document.getElementById('muteBtn'),
  leaveBtn: document.getElementById('leaveBtn'),
  status: document.getElementById('status'),
  controls: document.getElementById('controls'),
  participants: document.getElementById('participants'),
  participantsList: document.getElementById('participantsList'),
  messages: document.getElementById('messages'),
  muteIcon: document.getElementById('muteIcon'),
  muteText: document.getElementById('muteText')
};

// ====== EVENTOS DE SOCKET.IO ======

socket.on('connect', () => {
  console.log('✅ Conectado al servidor:', socket.id);
  addMessage('Conectado al servidor', 'system');
});

socket.on('disconnect', () => {
  console.log('❌ Desconectado del servidor');
  addMessage('Desconectado del servidor', 'system');
});

// Cuando un nuevo usuario se une
socket.on('user-joined', async ({ userId, username }) => {
  console.log('👤 Nuevo usuario:', username, userId);
  addMessage(`${username} se unió a la sala`, 'system');
  addParticipant(username, false, userId);
  
  // Crear oferta para el nuevo usuario
  await createPeerConnection(userId, true);
});

// Recibir usuarios existentes
socket.on('existing-users', async (userIds) => {
  console.log('👥 Usuarios existentes:', userIds);
  // No creamos ofertas aquí, esperamos a que ellos nos las envíen
});

// Recibir oferta
socket.on('offer', async ({ offer, from, username }) => {
  console.log('📥 Oferta recibida de:', from);
  const pc = await createPeerConnection(from, false);
  
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  
  socket.emit('answer', {
    answer: answer,
    to: from
  });
});

// Recibir respuesta
socket.on('answer', async ({ answer, from }) => {
  console.log('📤 Respuesta recibida de:', from);
  const pc = state.peerConnections.get(from);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

// Recibir candidato ICE
socket.on('ice-candidate', async ({ candidate, from }) => {
  const pc = state.peerConnections.get(from);
  if (pc && candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

// Usuario salió
socket.on('user-left', ({ userId, username }) => {
  console.log('👋 Usuario salió:', username);
  addMessage(`${username} salió de la sala`, 'system');
  
  // Cerrar conexión peer
  const pc = state.peerConnections.get(userId);
  if (pc) {
    pc.close();
    state.peerConnections.delete(userId);
  }
  
  // Remover audio remoto
  const audio = document.getElementById(`audio-${userId}`);
  if (audio) audio.remove();
  
  // Remover de la lista de participantes
  const participant = document.getElementById(`participant-${userId}`);
  if (participant) participant.remove();
});

// Actualización de usuarios en la sala
socket.on('room-users-update', ({ count, users }) => {
  console.log(`👥 Usuarios en la sala: ${count}`);
  updateStatus(`✅ Conectado a la sala: ${state.currentRoom} (${count} usuario${count > 1 ? 's' : ''})`, 'connected');
});

// ====== FUNCIONES PRINCIPALES ======

// Inicializar
function init() {
  elements.joinBtn.addEventListener('click', handleJoinRoom);
  elements.muteBtn.addEventListener('click', toggleMute);
  elements.leaveBtn.addEventListener('click', leaveRoom);
  
  elements.roomId.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
  });
  elements.username.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
  });

  window.addEventListener('beforeunload', leaveRoom);
  
  addMessage('Sistema listo. Ingresa tus datos para comenzar.', 'system');
}

// Unirse a la sala
async function handleJoinRoom() {
  const roomId = elements.roomId.value.trim();
  const username = elements.username.value.trim();

  if (!roomId) {
    updateStatus('Por favor ingresa un ID de sala', 'error');
    return;
  }

  if (!username) {
    updateStatus('Por favor ingresa tu nombre', 'error');
    return;
  }

  state.currentRoom = roomId;
  state.username = username;

  updateStatus('Accediendo al micrófono...', 'normal');
  elements.joinBtn.disabled = true;

  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    updateStatus(`✅ Conectado a la sala: ${roomId}`, 'connected');
    addMessage(`Te uniste a la sala ${roomId}`, 'system');

    elements.controls.classList.remove('hidden');
    elements.participants.classList.remove('hidden');
    
    elements.roomId.disabled = true;
    elements.username.disabled = true;

    addParticipant(username, true, socket.id);
    detectSpeaking();

    // Unirse a la sala en el servidor
    socket.emit('join-room', { roomId, username });

  } catch (error) {
    console.error('Error al acceder al micrófono:', error);
    updateStatus('❌ Error: No se pudo acceder al micrófono', 'error');
    elements.joinBtn.disabled = false;
    
    if (error.name === 'NotAllowedError') {
      addMessage('Permiso de micrófono denegado. Por favor, permite el acceso.', 'system');
    }
  }
}

// Crear conexión peer
async function createPeerConnection(userId, createOffer) {
  const pc = new RTCPeerConnection(configuration);
  state.peerConnections.set(userId, pc);

  // Agregar tracks locales
  state.localStream.getTracks().forEach(track => {
    pc.addTrack(track, state.localStream);
  });

  // Recibir tracks remotos
  pc.ontrack = (event) => {
    console.log('🎵 Track remoto recibido de:', userId);
    
    let audio = document.getElementById(`audio-${userId}`);
    if (!audio) {
      audio = new Audio();
      audio.id = `audio-${userId}`;
      audio.autoplay = true;
      document.body.appendChild(audio);
    }
    
    if (!audio.srcObject) {
      audio.srcObject = event.streams[0];
    }
  };

  // Manejar candidatos ICE
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        candidate: event.candidate,
        to: userId
      });
    }
  };

  // Crear oferta si somos los iniciadores
  if (createOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit('offer', {
      offer: offer,
      to: userId
    });
  }

  return pc;
}

// Toggle mute
function toggleMute() {
  if (!state.localStream) return;

  state.isMuted = !state.isMuted;
  
  state.localStream.getAudioTracks().forEach(track => {
    track.enabled = !state.isMuted;
  });

  if (state.isMuted) {
    elements.muteIcon.textContent = '🔇';
    elements.muteText.textContent = 'Activar';
    elements.muteBtn.style.background = '#4CAF50';
    addMessage('Micrófono silenciado', 'system');
  } else {
    elements.muteIcon.textContent = '🎤';
    elements.muteText.textContent = 'Silenciar';
    elements.muteBtn.style.background = '#ff9800';
    addMessage('Micrófono activado', 'system');
  }
}

// Salir de la sala
function leaveRoom() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => track.stop());
    state.localStream = null;
  }

  state.peerConnections.forEach(pc => pc.close());
  state.peerConnections.clear();

  document.querySelectorAll('audio[id^="audio-"]').forEach(audio => audio.remove());

  socket.disconnect();
  socket.connect();

  updateStatus('Desconectado de la sala', 'normal');
  addMessage('Saliste de la sala', 'system');
  
  elements.controls.classList.add('hidden');
  elements.participants.classList.add('hidden');
  elements.roomId.disabled = false;
  elements.username.disabled = false;
  elements.joinBtn.disabled = false;
  elements.roomId.value = '';
  elements.username.value = '';
  
  elements.participantsList.innerHTML = '';

  state.currentRoom = null;
  state.username = null;
  state.isMuted = false;
  
  elements.muteIcon.textContent = '🎤';
  elements.muteText.textContent = 'Silenciar';
  elements.muteBtn.style.background = '#ff9800';
}

// Actualizar estado
function updateStatus(message, type = 'normal') {
  elements.status.textContent = message;
  elements.status.className = 'status';
  
  if (type === 'connected') {
    elements.status.classList.add('connected');
  } else if (type === 'error') {
    elements.status.classList.add('error');
  }
}

// Agregar mensaje
function addMessage(text, type = 'normal') {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.textContent = `${new Date().toLocaleTimeString()}: ${text}`;
  
  elements.messages.appendChild(messageDiv);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

// Agregar participante
function addParticipant(name, isLocal = false, userId = null) {
  const participantDiv = document.createElement('div');
  participantDiv.className = 'participant';
  participantDiv.id = `participant-${userId || 'local'}`;
  participantDiv.innerHTML = `
    <span>${isLocal ? '👤' : '👥'}</span>
    <strong>${name}</strong>
    ${isLocal ? '(Tú)' : ''}
  `;
  
  elements.participantsList.appendChild(participantDiv);
}

// Detectar cuando el usuario está hablando
function detectSpeaking() {
  if (!state.localStream) return;

  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = audioContext.createAnalyser();
  const microphone = audioContext.createMediaStreamSource(state.localStream);
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  microphone.connect(analyser);
  analyser.fftSize = 256;

  function checkVolume() {
    if (!state.localStream) return;

    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

    const localParticipant = document.getElementById(`participant-${socket.id}`);
    if (localParticipant) {
      if (average > 20 && !state.isMuted) {
        localParticipant.classList.add('speaking');
      } else {
        localParticipant.classList.remove('speaking');
      }
    }

    requestAnimationFrame(checkVolume);
  }

  checkVolume();
}

// Inicializar
init();