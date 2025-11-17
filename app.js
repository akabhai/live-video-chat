// =============================================================================
//  Main Application Logic (app.js) - CORRECTED
// =============================================================================
// This logic will run after the DOM is ready and all deferred scripts are loaded.
// FIX: Added `SimplePeer` which was missing and is required for WebRTC data channels.
// FIX: Changed WebTorrent client instantiation to check for `WebTorrent.WEBRTC_SUPPORT`.

if (!WebTorrent.WEBRTC_SUPPORT) {
    alert("Your browser does not support WebRTC, which is required for this application to work.");
}

// Configuration
const CONFIG = {
    CHUNK_DURATION: 2000,
    STREAM_MIME_TYPE: 'video/webm; codecs="vp8, opus"',
    TORRENT_FILE_NAME: 'livestream.webm',
    TRACKERS: [
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.webtorrent.dev',
    ],
    RTC_CONFIG: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    }
};

// UI Elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startStreamBtn = document.getElementById('startStreamBtn');
const stopStreamBtn = document.getElementById('stopStreamBtn');
const playStreamBtn = document.getElementById('playStreamBtn');
const magnetLinkInput = document.getElementById('magnetLink');
const magnetInput = document.getElementById('magnetInput');
const copyMagnetBtn = document.getElementById('copyMagnetBtn');
const streamInfoDiv = document.getElementById('stream-info');
const statsOverlay = document.getElementById('stats-overlay');
const statusEl = document.getElementById('status');
const peerCountEl = document.getElementById('peerCount');
const latencyEl = document.getElementById('latency');
const downloadSpeedEl = document.getElementById('downloadSpeed');
const uploadSpeedEl = document.getElementById('uploadSpeed');
const darkModeToggle = document.getElementById('darkModeToggle');
const sunIcon = document.getElementById('sunIcon');
const moonIcon = document.getElementById('moonIcon');

let publisher = null;
let viewer = null;
let statsInterval = null;

// =========================================================================
//  Event Handlers
// =========================================================================
startStreamBtn.addEventListener('click', async () => {
    if (publisher) return;
    publisher = new Publisher(CONFIG);
    try {
        await publisher.start();
        magnetLinkInput.value = publisher.magnetURI;
        streamInfoDiv.style.display = 'block';
        startStreamBtn.disabled = true;
        stopStreamBtn.disabled = false;
        playStreamBtn.disabled = true;
        magnetInput.disabled = true;
        updateStatus('Broadcasting', 'green');
        statsOverlay.style.display = 'block';
        startStatsUpdater();
    } catch (err) {
        console.error("Failed to start stream:", err);
        alert("Error starting stream: " + err.message);
        if (publisher) publisher.stop();
        publisher = null;
    }
});

stopStreamBtn.addEventListener('click', () => {
    if (!publisher) return;
    publisher.stop();
    publisher = null;
    streamInfoDiv.style.display = 'none';
    magnetLinkInput.value = '';
    startStreamBtn.disabled = false;
    stopStreamBtn.disabled = true;
    playStreamBtn.disabled = false;
    magnetInput.disabled = false;
    localVideo.srcObject = null;
    updateStatus('Idle', 'yellow');
    stopStatsUpdater();
    statsOverlay.style.display = 'none';
});

playStreamBtn.addEventListener('click', async () => {
    const magnetURI = magnetInput.value.trim();
    if (!magnetURI.startsWith('magnet:')) {
        alert("Please enter a valid magnet link.");
        return;
    }
    if (viewer) viewer.destroy();

    playStreamBtn.textContent = 'Connecting...';
    playStreamBtn.disabled = true;
    startStreamBtn.disabled = true;

    try {
        viewer = new Viewer(CONFIG);
        await viewer.start(magnetURI);
        
        updateStatus('Connecting...', 'blue');
        statsOverlay.style.display = 'block';
        startStatsUpdater();
    } catch (err) {
        console.error("Failed to play stream:", err);
        alert("Error playing stream: " + err.message);
        if (viewer) viewer.destroy();
        viewer = null;
        playStreamBtn.textContent = 'Play';
        playStreamBtn.disabled = false;
        startStreamBtn.disabled = false;
        updateStatus('Error', 'red');
    }
});

copyMagnetBtn.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(magnetLinkInput.value);
        copyMagnetBtn.textContent = 'Copied!';
        setTimeout(() => { copyMagnetBtn.textContent = 'Copy'; }, 2000);
    } catch (err) {
        console.error('Failed to copy magnet link: ', err);
        alert('Could not copy link to clipboard.');
    }
});

darkModeToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    sunIcon.classList.toggle('hidden');
    moonIcon.classList.toggle('hidden');
    localStorage.setItem('darkMode', document.documentElement.classList.contains('dark'));
});

if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.classList.add('dark');
    sunIcon.classList.remove('hidden');
    moonIcon.classList.add('hidden');
}

// =========================================================================
//  Utility Functions
// =========================================================================
function updateStatus(text, color) {
    statusEl.textContent = text;
    statusEl.className = `font-semibold text-${color}-300`;
}

function formatSpeed(bytes) {
    if (bytes === 0) return '0 KB/s';
    const k = 1024;
    const sizes = ['Bytes/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function startStatsUpdater() {
    if (statsInterval) clearInterval(statsInterval);
    statsInterval = setInterval(() => {
        const client = publisher ? publisher.client : (viewer ? viewer.client : null);
        if (!client || client.destroyed) {
            stopStatsUpdater();
            return;
        }
        
        const torrent = client.torrents[0];
        peerCountEl.textContent = torrent ? torrent.numPeers : 0;
        downloadSpeedEl.textContent = formatSpeed(client.downloadSpeed);
        uploadSpeedEl.textContent = formatSpeed(client.uploadSpeed);
        
        if (viewer && viewer.latency > 0) {
            latencyEl.textContent = `${viewer.latency.toFixed(0)} ms`;
        } else {
            latencyEl.textContent = 'N/A';
        }
    }, 1000);
}

function stopStatsUpdater() {
    clearInterval(statsInterval);
    statsInterval = null;
}

// =============================================================================
//  Encryption Utilities
// =============================================================================
class CryptoUtils {
    static async generateKey() { return window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
    static async exportKey(key) { return window.crypto.subtle.exportKey('jwk', key); }
    static async importKey(jwk) { return window.crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']); }
    static async encrypt(data, key) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encryptedData = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
        return { encryptedData, iv };
    }
    static async decrypt(encryptedData, key, iv) { return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedData); }
}

// =============================================================================
//  Publisher Class
// =============================================================================
class Publisher {
    constructor(config) {
        this.config = config;
        this.client = new WebTorrent({ rtcConfig: config.RTC_CONFIG });
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.chunkCounter = 0;
        this.torrent = null;
        this.magnetURI = null;
        this.encryptionKey = null;
        this.exportedKey = null;
        this.peers = new Map();
    }

    async start() {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
        localVideo.srcObject = this.mediaStream;
        
        this.encryptionKey = await CryptoUtils.generateKey();
        this.exportedKey = await CryptoUtils.exportKey(this.encryptionKey);
        console.log("Generated session encryption key.");
        
        await this._createTorrent();
        console.log(`Torrent created. Magnet URI: ${this.magnetURI}`);
        
        this._setupMediaRecorder();
        this._listenForPeers();
    }

    stop() {
        console.log("Stopping stream...");
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') this.mediaRecorder.stop();
        if (this.mediaStream) this.mediaStream.getTracks().forEach(track => track.stop());
        this.peers.forEach(peer => peer.destroy());
        this.peers.clear();
        if (!this.client.destroyed) this.client.destroy();
        console.log("Stream stopped.");
    }
    
    _createTorrent() {
        return new Promise((resolve, reject) => {
            const placeholderFile = new File([new Uint8Array(1)], this.config.TORRENT_FILE_NAME, { type: this.config.STREAM_MIME_TYPE });
            this.client.seed(placeholderFile, { announce: this.config.TRACKERS }, (torrent) => {
                this.torrent = torrent;
                this.magnetURI = torrent.magnetURI;
                this.torrent.pieces = new Array(1000000); // Virtual pieces
                this.torrent.length = this.torrent.pieceLength * this.torrent.pieces.length;
                resolve();
            });
            this.client.on('error', reject);
        });
    }

    _setupMediaRecorder() {
        this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType: this.config.STREAM_MIME_TYPE, videoBitsPerSecond: 2500000 });
        this.mediaRecorder.ondataavailable = async (event) => {
            if (event.data.size > 0) {
                const chunkIndex = this.chunkCounter++;
                const chunkData = await event.data.arrayBuffer();
                const { encryptedData, iv } = await CryptoUtils.encrypt(chunkData, this.encryptionKey);
                
                this.torrent.store.put(chunkIndex, Buffer.from(encryptedData), (err) => {
                    if (err) return console.error("Error storing piece:", err);
                    this._broadcastMetadata({
                        type: 'chunk',
                        index: chunkIndex,
                        iv: Array.from(iv),
                        timestamp: Date.now(),
                    });
                });
            }
        };
        this.mediaRecorder.start(this.config.CHUNK_DURATION);
    }

    _listenForPeers() {
        this.torrent.on('wire', (wire) => {
            console.log('New peer connected:', wire.peerId);
            const peer = new SimplePeer({ initiator: true, trickle: false, config: this.config.RTC_CONFIG });
            
            peer.on('signal', data => wire.extended('rtc_signal', JSON.stringify(data)));
            wire.on('extended', (ext, payload) => { if (ext === 'rtc_signal') peer.signal(JSON.parse(payload.toString())) });

            peer.on('connect', () => {
                console.log('WebRTC DataChannel established with peer:', wire.peerId);
                this.peers.set(wire.peerId, peer);
                peer.send(JSON.stringify({ type: 'init', mimeType: this.config.STREAM_MIME_TYPE, encryptionKey: this.exportedKey }));
            });
            peer.on('close', () => this.peers.delete(wire.peerId));
            peer.on('error', () => this.peers.delete(wire.peerId));
        });
    }
    
    _broadcastMetadata(metadata) {
        const message = JSON.stringify(metadata);
        this.peers.forEach(peer => { if (peer.connected) peer.send(message) });
    }
}

// =============================================================================
//  Player and Viewer Classes
// =============================================================================
class Player {
    constructor(videoElement, mimeType) {
        this.videoElement = videoElement;
        this.mediaSource = new MediaSource();
        this.sourceBuffer = null;
        this.queue = [];
        this.isAppending = false;
        
        this.videoElement.src = URL.createObjectURL(this.mediaSource);
        this.mediaSource.addEventListener('sourceopen', () => {
            this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
            this.sourceBuffer.addEventListener('updateend', () => {
                this.isAppending = false;
                this._processQueue();
            });
        });
    }

    append(chunk) {
        this.queue.push(chunk);
        if (!this.isAppending) this._processQueue();
    }
    
    _processQueue() {
        if (this.queue.length > 0 && this.sourceBuffer && !this.sourceBuffer.updating) {
            this.isAppending = true;
            try {
                this.sourceBuffer.appendBuffer(this.queue.shift());
                const bufferedEnd = this.videoElement.buffered.length ? this.videoElement.buffered.end(this.videoElement.buffered.length - 1) : 0;
                if (bufferedEnd - this.videoElement.currentTime > 5) {
                    this.videoElement.currentTime = bufferedEnd - 0.5;
                }
            } catch (e) {
                console.error("Error appending buffer:", e);
                this.isAppending = false;
            }
        }
    }
}

class Viewer {
    constructor(config) {
        this.config = config;
        this.client = new WebTorrent({ rtcConfig: config.RTC_CONFIG });
        this.torrent = null;
        this.player = null;
        this.encryptionKey = null;
        this.pendingChunks = new Map();
        this.nextChunkIndex = 0;
        this.latency = 0;
    }

    start(magnetURI) {
        return new Promise((resolve, reject) => {
            console.log("Joining stream:", magnetURI);
            this.torrent = this.client.add(magnetURI, { announce: this.config.TRACKERS });
            
            this.torrent.on('infoHash', () => console.log('Viewer got info hash'));
            this.torrent.on('wire', (wire) => this._setupWebRTC(wire));
            this.torrent.on('piece', (index, buffer) => this._handlePiece(index, buffer));
            this.torrent.on('error', err => {
                console.error('Torrent error:', err);
                reject(err);
            });
            this.client.on('error', err => {
                console.error('WebTorrent client error:', err);
                reject(err);
            });
            
            // Timeout if we can't find peers
            setTimeout(() => {
                if (!this.player) reject(new Error("Could not connect to stream peers in time."));
            }, 20000); // 20 seconds
        });
    }

    destroy() {
        if (!this.client.destroyed) this.client.destroy();
        console.log("Viewer destroyed.");
    }

    _setupWebRTC(wire) {
        const peer = new SimplePeer({ initiator: false, trickle: false, config: this.config.RTC_CONFIG });
        peer.on('signal', data => wire.extended('rtc_signal', JSON.stringify(data)));
        wire.on('extended', (ext, payload) => { if (ext === 'rtc_signal') peer.signal(JSON.parse(payload.toString())) });
        peer.on('data', (data) => this._handleMetadata(JSON.parse(data.toString())));
        peer.on('error', err => console.error("WebRTC peer error:", err));
    }
    
    async _handleMetadata(metadata) {
        if (metadata.type === 'init') {
            this.encryptionKey = await CryptoUtils.importKey(metadata.encryptionKey);
            this.player = new Player(remoteVideo, metadata.mimeType);
            updateStatus('Streaming', 'green');
            playStreamBtn.textContent = 'Play'; // Reset button text
            playStreamBtn.disabled = false; // Re-enable for potential restarts
        } else if (metadata.type === 'chunk' && this.encryptionKey) {
            const { index, iv, timestamp } = metadata;
            if (index >= this.nextChunkIndex) {
                 this.pendingChunks.set(index, { iv, timestamp });
                 this.torrent.select(index, index, true);
            }
        }
    }
    
    async _handlePiece(index, buffer) {
        const metadata = this.pendingChunks.get(index);
        if (!metadata) return;

        try {
            const decryptedChunk = await CryptoUtils.decrypt(buffer, this.encryptionKey, new Uint8Array(metadata.iv));
            this.player.append(decryptedChunk);
            this.pendingChunks.delete(index);
            this.nextChunkIndex = index + 1;
            this.latency = Date.now() - metadata.timestamp;
            if (remoteVideo.paused) remoteVideo.play().catch(e => console.warn("Autoplay failed:", e));
        } catch (e) {
            console.error(`Decryption failed for chunk ${index}:`, e);
        }
    }
}
