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

  elements.speakerBtn.addEventListener('click', toggleSpeaker);

  // Enter keys
  elements.roomId.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
  });
  elements.username.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
  });
}

function toggleSpeaker() {
  const btn = elements.speakerBtn;
  const isActive = btn.classList.toggle('active');

  // Opción 1: Mute/Unmute audio entrante (Deafen)
  // Iterar sobre todos los elementos de audio y mutearlos
  document.querySelectorAll('audio').forEach(audio => {
    // Si está activo (Speaker on), volumen 1. Si no, volumen 0 (o silenciado)
    // Pero "Speaker" suele significar "Altavoz" vs "Auricular".
    // En navegadores web, no siempre se puede controlar esto (setSinkId es experimental).
    // Implementaremos "Deafen" (Silenciar a todos) como fallback común o comportamiento esperado si no podemos cambiar salidas.

    // Comportamiento: Speaker ON = Escucho todo (Muted = false). Speaker OFF = No escucho nada (Muted = true)?
    // O Speaker ON = Volumen Alto. 

    // Vamos a asumir que el usuario quiere poder silenciar lo que escucha (Deafen).
    // Si el botón está "active" (color/resaltado), escuchamos. Si no, silencio.
    // Ajustemos la lógica visual: Por defecto está en "Speaker" (escuchando).

    // Si queremos cambiar dispositivo de salida (Chrome only):
    if (typeof audio.setSinkId === 'function') {
      // Esto requeriría listar dispositivos y seleccionar el de tipo 'speaker'. 
      // Por simplicidad y compatibilidad, haremos Mute de salida (Deafen)
    }

    audio.muted = !isActive;
  });

  if (isActive) {
    btn.querySelector('.btn-label').textContent = 'Speaker On';
    btn.style.opacity = '1';
  } else {
    btn.querySelector('.btn-label').textContent = 'Speaker Off';
    btn.style.opacity = '0.5';
  }
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

    if (elements.micIconMain) elements.micIconMain.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="800px" height="800px" viewBox="0 0 24 24" fill="none">
<path d="M15 9.4V5C15 3.34315 13.6569 2 12 2C10.8224 2 9.80325 2.67852 9.3122 3.66593M12 19V22M8 22H16M3 3L21 21M5.00043 10C5.00043 10 3.50062 19 12.0401 19C14.51 19 16.1333 18.2471 17.1933 17.1768M19.0317 13C19.2365 11.3477 19 10 19 10M15 6H13M12 15C10.3431 15 9 13.6569 9 12V9L14.1226 14.12C13.5796 14.6637 12.8291 15 12 15Z" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
    // Update local visual status
    updateParticipantStatus(socket.id, 'muted');
  } else {
    micBtn.classList.remove('muted');
    elements.muteText.textContent = 'Tap to Mute';
    if (elements.micIconMain) elements.micIconMain.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="800px" height="800px" viewBox="0 0 24 24" fill="none">
<path d="M19 10V12C19 15.866 15.866 19 12 19M5 10V12C5 15.866 8.13401 19 12 19M12 19V22M8 22H16M15 6H13M15 10H13M12 15C10.3431 15 9 13.6569 9 12V5C9 3.34315 10.3431 2 12 2C13.6569 2 15 3.34315 15 5V12C15 13.6569 13.6569 15 12 15Z" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

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
  if (elements.micIconMain) elements.micIconMain.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="800px" height="800px" viewBox="0 0 24 24" fill="none">
<path d="M19 10V12C19 15.866 15.866 19 12 19M5 10V12C5 15.866 8.13401 19 12 19M12 19V22M8 22H16M15 6H13M15 10H13M12 15C10.3431 15 9 13.6569 9 12V5C9 3.34315 10.3431 2 12 2C13.6569 2 15 3.34315 15 5V12C15 13.6569 13.6569 15 12 15Z" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
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