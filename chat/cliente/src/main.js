import { io } from 'socket.io-client';

// Conectar al servidor
const socket = io(import.meta.env.PROD ? undefined : 'http://localhost:3000');

// Estado de la aplicación
const state = {
  localStream: null,
  peerConnections: new Map(),
  isMuted: false,
  currentRoom: null,
  username: null,
  remoteStreams: new Map()
};

// Configuración de WebRTC
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Elementos del DOM
const elements = {
  joinScreen: document.getElementById('join-screen'),
  callScreen: document.getElementById('call-screen'),
  roomId: document.getElementById('roomId'),
  username: document.getElementById('username'),
  joinBtn: document.getElementById('joinBtn'),
  muteBtn: document.getElementById('muteBtn'),
  leaveBtn: document.getElementById('leaveBtn'),
  speakerBtn: document.getElementById('speakerBtn'),
  participantsList: document.getElementById('participantsList'),
  muteText: document.getElementById('muteText'),
  statusToast: document.getElementById('status'),
  micIconMain: document.getElementById('micIconMain')
};

// ====== EVENTOS DE SOCKET.IO ======

socket.on('connect', () => {
  console.log('✅ Conectado al servidor:', socket.id);
  showToast('Conectado al servidor', 'success');
});

socket.on('disconnect', () => {
  console.log('❌ Desconectado del servidor');
  showToast('Desconectado del servidor', 'error');
});

socket.on('user-joined', async ({ userId, username }) => {
  showToast(`${username} entró`, 'info');
  addParticipant(username, false, userId);
  await createPeerConnection(userId, true);
});

socket.on('existing-users', async (userIds) => {
  // Esperamos ofertas de ellos
});

socket.on('offer', async ({ offer, from, username }) => {
  const pc = await createPeerConnection(from, false);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { answer, to: from });
});

socket.on('answer', async ({ answer, from }) => {
  const pc = state.peerConnections.get(from);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

socket.on('ice-candidate', async ({ candidate, from }) => {
  const pc = state.peerConnections.get(from);
  if (pc && candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

socket.on('user-left', ({ userId, username }) => {
  showToast(`${username} salió`, 'info');

  const pc = state.peerConnections.get(userId);
  if (pc) {
    pc.close();
    state.peerConnections.delete(userId);
  }

  const audio = document.getElementById(`audio-${userId}`);
  if (audio) audio.remove();

  const participant = document.getElementById(`participant-${userId}`);
  if (participant) participant.remove();
});

socket.on('room-users-update', ({ count, users }) => {
  // Opcional: actualizar contador en header si existiera
});

// ====== FUNCIONES PRINCIPALES ======

function init() {
  elements.joinBtn.addEventListener('click', handleJoinRoom);
  elements.muteBtn.addEventListener('click', toggleMute);
  elements.leaveBtn.addEventListener('click', leaveRoom);

  // Enter keys
  elements.roomId.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
  });
  elements.username.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
  });
}

function switchScreen(screenName) {
  if (screenName === 'call') {
    elements.joinScreen.classList.add('hidden');
    elements.joinScreen.classList.remove('active');
    elements.callScreen.classList.remove('hidden');
    // pekeño delay para fade in si quisieramos animaciones css mas complejas
  } else {
    elements.callScreen.classList.add('hidden');
    elements.joinScreen.classList.remove('hidden');
    elements.joinScreen.classList.add('active');
  }
}

async function handleJoinRoom() {
  const roomId = elements.roomId.value.trim();
  const username = elements.username.value.trim();

  if (!roomId || !username) {
    showToast('Completa todos los campos', 'error');
    return;
  }

  state.currentRoom = roomId;
  state.username = username;

  elements.joinBtn.textContent = 'Uniéndose...';
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

    // Éxito al obtener mic
    switchScreen('call');
    addParticipant(username, true, socket.id);

    // Unirse en socket
    socket.emit('join-room', { roomId, username });

    detectSpeaking();

    // Restaurar btn
    elements.joinBtn.textContent = 'Unirse';
    elements.joinBtn.disabled = false;

  } catch (error) {
    console.error(error);
    showToast('Acceso al micrófono denegado', 'error');
    elements.joinBtn.textContent = 'Unirse';
    elements.joinBtn.disabled = false;
  }
}

async function createPeerConnection(userId, createOffer) {
  const pc = new RTCPeerConnection(configuration);
  state.peerConnections.set(userId, pc);

  state.localStream.getTracks().forEach(track => {
    pc.addTrack(track, state.localStream);
  });

  pc.ontrack = (event) => {
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

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { candidate: event.candidate, to: userId });
    }
  };

  if (createOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { offer, to: userId });
  }

  return pc;
}

function toggleMute() {
  if (!state.localStream) return;
  state.isMuted = !state.isMuted;

  state.localStream.getAudioTracks().forEach(track => {
    track.enabled = !state.isMuted;
  });

  const micBtn = elements.muteBtn;
  if (state.isMuted) {
    micBtn.classList.add('muted');
    elements.muteText.textContent = 'Muted';
    if (elements.micIconMain) elements.micIconMain.textContent = '🔇';

    // Update local visual status
    updateParticipantStatus(socket.id, 'muted');
  } else {
    micBtn.classList.remove('muted');
    elements.muteText.textContent = 'Tap to Mute';
    if (elements.micIconMain) elements.micIconMain.textContent = '🎤';

    updateParticipantStatus(socket.id, 'talking');
  }
}

function leaveRoom() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => track.stop());
    state.localStream = null;
  }

  state.peerConnections.forEach(pc => pc.close());
  state.peerConnections.clear();

  document.querySelectorAll('audio[id^="audio-"]').forEach(a => a.remove());

  socket.disconnect();
  socket.connect();

  state.currentRoom = null;
  state.username = null;
  state.isMuted = false;

  elements.participantsList.innerHTML = '';
  switchScreen('join');

  // Reset mute UI
  elements.muteBtn.classList.remove('muted');
  elements.muteText.textContent = 'Tap to Mute';
  if (elements.micIconMain) elements.micIconMain.textContent = '🎤';
}

// UI Helpers

function addParticipant(name, isLocal, userId) {
  // Evitar duplicados
  if (document.getElementById(`participant-${userId}`)) return;

  const div = document.createElement('div');
  div.className = 'participant-item';
  div.id = `participant-${userId}`;

  const initial = name.charAt(0).toUpperCase();

  // Random avatar color
  const colors = ['#FF5722', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#009688'];
  const bg = colors[userId.charCodeAt(0) % colors.length] || '#333';

  div.innerHTML = `
    <div class="avatar" style="background: ${bg}">${initial}</div>
    <div class="participant-info">
      <div class="participant-name">${name} ${isLocal ? '(You)' : ''}</div>
      <div class="participant-status ${isLocal ? 'talking' : 'muted'}">
        ${isLocal ? 'Connected' : 'Listening'}
      </div>
    </div>
    <div class="status-icon ${isLocal ? 'active' : ''}">
      ${isLocal ? '●' : ''} 
    </div>
  `;

  elements.participantsList.appendChild(div);
}

function updateParticipantStatus(userId, status) { // status: 'talking' | 'muted'
  const el = document.getElementById(`participant-${userId}`);
  if (!el) return;

  const statusEl = el.querySelector('.participant-status');
  if (status === 'talking') {
    statusEl.textContent = 'Speaking...';
    statusEl.classList.add('talking');
    statusEl.classList.remove('muted');
  } else {
    statusEl.textContent = 'Muted';
    statusEl.classList.remove('talking');
    statusEl.classList.add('muted');
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;

  container.appendChild(toast);

  // Trigger reflow
  toast.offsetHeight;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

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

    // Threshold logic
    if (average > 25 && !state.isMuted) {
      updateParticipantStatus(socket.id, 'talking');
      // Visual feedback on main button
      if (elements.micIconMain) elements.micIconMain.style.transform = `scale(${1 + average / 200})`;
    } else if (!state.isMuted) {
      // Silent but active
      const el = document.getElementById(`participant-${socket.id}`);
      if (el) {
        const statusEl = el.querySelector('.participant-status');
        statusEl.textContent = 'Connected';
        statusEl.classList.remove('talking', 'muted');
        statusEl.style.color = '#4CAF50';
      }
      if (elements.micIconMain) elements.micIconMain.style.transform = 'scale(1)';
    }

    requestAnimationFrame(checkVolume);
  }
  checkVolume();
}

init();