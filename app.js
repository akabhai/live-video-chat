// =============================================================================
//  Main Application Logic (app.js)
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log("P2P Live Streamer Initializing...");

    // Configuration
    const CONFIG = {
        CHUNK_DURATION: 2000, // in milliseconds (2 seconds)
        STREAM_MIME_TYPE: 'video/webm; codecs="vp8, opus"',
        TORRENT_FILE_NAME: 'livestream.webm',
        // Public trackers for peer discovery
        TRACKERS: [
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.webtorrent.dev',
            'wss://tracker.files.fm:7073/announce',
        ],
        // Optional STUN/TURN servers for NAT traversal
        RTC_CONFIG: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
                // Add TURN servers here if needed for restrictive NATs
                // {
                //   urls: 'turn:YOUR_TURN_SERVER:3478',
                //   username: 'user',
                //   credential: 'password'
                // }
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
            alert("Error starting stream. Check console for details.");
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

    playStreamBtn.addEventListener('click', () => {
        const magnetURI = magnetInput.value.trim();
        if (!magnetURI) {
            alert("Please enter a magnet link.");
            return;
        }
        if (viewer) viewer.destroy();

        viewer = new Viewer(CONFIG);
        viewer.start(magnetURI);
        
        startStreamBtn.disabled = true;
        stopStreamBtn.disabled = true;
        playStreamBtn.textContent = 'Playing...';
        playStreamBtn.disabled = true;
        updateStatus('Connecting...', 'blue');
        statsOverlay.style.display = 'block';
        startStatsUpdater();
    });

    copyMagnetBtn.addEventListener('click', () => {
        magnetLinkInput.select();
        document.execCommand('copy');
        copyMagnetBtn.textContent = 'Copied!';
        setTimeout(() => { copyMagnetBtn.textContent = 'Copy'; }, 2000);
    });
    
    // Dark Mode Toggle
    darkModeToggle.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
        sunIcon.classList.toggle('hidden');
        moonIcon.classList.toggle('hidden');
        localStorage.setItem('darkMode', document.documentElement.classList.contains('dark'));
    });

    // Check for saved dark mode preference
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
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + ['Bytes', 'KB', 'MB'][i] + '/s';
    }

    function startStatsUpdater() {
        if (statsInterval) clearInterval(statsInterval);
        statsInterval = setInterval(() => {
            const client = publisher ? publisher.client : (viewer ? viewer.client : null);
            if (!client) return;

            peerCountEl.textContent = client.torrents.reduce((acc, t) => acc + t.numPeers, 0);
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
});


// =============================================================================
//  5. Encryption Utilities
// =============================================================================
class CryptoUtils {
    static async generateKey() {
        return window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true, // extractable
            ['encrypt', 'decrypt']
        );
    }

    static async exportKey(key) {
        return window.crypto.subtle.exportKey('jwk', key);
    }
    
    static async importKey(jwk) {
        return window.crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    static async encrypt(data, key) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
        const encryptedData = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );
        return { encryptedData, iv };
    }

    static async decrypt(encryptedData, key, iv) {
        return window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encryptedData
        );
    }
}


// =============================================================================
//  Publisher Class (Handles broadcasting logic)
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
        this.peers = new Map(); // Store WebRTC connections to peers
    }

    async start() {
        // 1. Get user media
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720 },
            audio: true
        });
        document.getElementById('localVideo').srcObject = this.mediaStream;
        
        // 2. Generate encryption key
        this.encryptionKey = await CryptoUtils.generateKey();
        this.exportedKey = await CryptoUtils.exportKey(this.encryptionKey);
        console.log("Generated session encryption key.");

        // 3. Create torrent to seed
        await this._createTorrent();
        console.log(`Torrent created. Magnet URI: ${this.magnetURI}`);

        // 4. Setup MediaRecorder
        this._setupMediaRecorder();

        // 5. Start listening for new peers to send metadata
        this._listenForPeers();
    }

    stop() {
        console.log("Stopping stream...");
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (this.torrent) {
            this.torrent.destroy();
        }
        this.peers.forEach(peer => peer.destroy());
        this.peers.clear();
        this.client.destroy();
        console.log("Stream stopped.");
    }
    
    _createTorrent() {
        return new Promise((resolve, reject) => {
            const placeholderData = new Uint8Array(1); // Small placeholder
            const placeholderFile = new File([placeholderData], this.config.TORRENT_FILE_NAME, { type: this.config.STREAM_MIME_TYPE });
            
            this.client.seed(placeholderFile, {
                announce: this.config.TRACKERS,
                name: this.config.TORRENT_FILE_NAME,
            }, (torrent) => {
                this.torrent = torrent;
                this.magnetURI = torrent.magnetURI;
                
                // Hack to make the torrent seem very large to accommodate a long stream
                this.torrent.pieces = new Array(1000000); // Allow for a very long stream
                this.torrent.length = this.torrent.pieceLength * this.torrent.pieces.length;
                
                resolve();
            });
        });
    }

    _setupMediaRecorder() {
        this.mediaRecorder = new MediaRecorder(this.mediaStream, {
            mimeType: this.config.STREAM_MIME_TYPE,
            videoBitsPerSecond : 2500000, // 2.5 Mbps
        });

        this.mediaRecorder.ondataavailable = async (event) => {
            if (event.data.size > 0) {
                const chunkIndex = this.chunkCounter++;
                const chunkData = await event.data.arrayBuffer();
                
                // Encrypt the chunk
                const { encryptedData, iv } = await CryptoUtils.encrypt(chunkData, this.encryptionKey);
                
                // Seed the encrypted chunk as a torrent piece
                this.torrent.store.put(chunkIndex, Buffer.from(encryptedData), (err) => {
                    if (err) console.error("Error storing piece:", err);
                    else {
                        // Broadcast metadata to all connected peers
                        this._broadcastMetadata({
                            type: 'chunk',
                            index: chunkIndex,
                            iv: Array.from(iv), // Convert Uint8Array to array for JSON serialization
                            timestamp: Date.now(),
                        });
                    }
                });
            }
        };

        this.mediaRecorder.start(this.config.CHUNK_DURATION);
        console.log("MediaRecorder started.");
    }

    _listenForPeers() {
        this.torrent.on('wire', (wire) => {
            console.log('New peer connected:', wire.peerId);

            const peer = new SimplePeer({
                initiator: true,
                trickle: false,
                config: this.config.RTC_CONFIG
            });
            
            peer.on('signal', (data) => {
                // Use WebTorrent wire for signaling
                wire.extended('rtc_signal', JSON.stringify(data));
            });

            wire.on('extended', (ext, payload) => {
                if (ext === 'rtc_signal') {
                    peer.signal(JSON.parse(payload.toString()));
                }
            });

            peer.on('connect', () => {
                console.log('WebRTC DataChannel established with peer:', wire.peerId);
                this.peers.set(wire.peerId, peer);
                
                // Send initial metadata (MIME type and encryption key)
                peer.send(JSON.stringify({
                    type: 'init',
                    mimeType: this.config.STREAM_MIME_TYPE,
                    encryptionKey: this.exportedKey
                }));
            });
            
            peer.on('close', () => {
                console.log('Peer disconnected:', wire.peerId);
                this.peers.delete(wire.peerId);
            });
            
            peer.on('error', (err) => {
                console.error('Peer error:', wire.peerId, err);
                this.peers.delete(wire.peerId);
            });
        });
    }
    
    _broadcastMetadata(metadata) {
        const message = JSON.stringify(metadata);
        this.peers.forEach(peer => {
            if (peer.connected) {
                peer.send(message);
            }
        });
    }
}


// =============================================================================
//  6. Chunker and Player Utilities (Combined into Viewer and Player)
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
            console.log("MediaSource opened.");
            this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
            this.sourceBuffer.addEventListener('updateend', () => {
                this.isAppending = false;
                this._processQueue();
            });
        });
    }

    append(chunk) {
        this.queue.push(chunk);
        if (!this.isAppending) {
            this._processQueue();
        }
    }
    
    _processQueue() {
        if (this.queue.length > 0 && this.sourceBuffer && !this.sourceBuffer.updating) {
            this.isAppending = true;
            const chunk = this.queue.shift();
            try {
                this.sourceBuffer.appendBuffer(chunk);
                // Auto-seek to live edge if playback falls behind
                if (this.videoElement.buffered.length > 0) {
                    const bufferedEnd = this.videoElement.buffered.end(this.videoElement.buffered.length - 1);
                    const diff = bufferedEnd - this.videoElement.currentTime;
                    if (diff > 5) { // If more than 5s behind
                        this.videoElement.currentTime = bufferedEnd - 0.5;
                        console.log("Seeking to live edge.");
                    }
                }
            } catch(e) {
                console.error("Error appending buffer:", e);
                this.isAppending = false;
            }
        }
    }
}


// =============================================================================
//  7. Peer Mesh Logic & Viewer Class
// =============================================================================
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
        console.log("Joining stream:", magnetURI);
        this.torrent = this.client.add(magnetURI, { announce: this.config.TRACKERS });
        
        this.torrent.on('wire', (wire) => {
            console.log('Connected to a new peer:', wire.peerId);
            this._setupWebRTC(wire);
        });

        this.torrent.on('piece', (index, buffer) => {
             this._handlePiece(index, buffer);
        });
        
        this.torrent.on('done', () => {
            console.log('Torrent download finished (this should not happen in a live stream).');
        });
        
        this.torrent.on('error', (err) => {
            console.error('Torrent error:', err);
        });
    }

    destroy() {
        if (this.torrent) this.torrent.destroy();
        if (this.client) this.client.destroy();
        console.log("Viewer destroyed.");
    }

    _setupWebRTC(wire) {
        // Use WebTorrent wire for signaling to connect via WebRTC for metadata
        const peer = new SimplePeer({
            initiator: false,
            trickle: false,
            config: this.config.RTC_CONFIG
        });

        peer.on('signal', (data) => {
            wire.extended('rtc_signal', JSON.stringify(data));
        });

        wire.on('extended', (ext, payload) => {
            if (ext === 'rtc_signal') {
                peer.signal(JSON.parse(payload.toString()));
            }
        });

        peer.on('connect', () => {
            console.log('WebRTC DataChannel established with publisher/peer.');
            document.querySelector('#status').textContent = 'Connected';
        });

        peer.on('data', (data) => {
            this._handleMetadata(JSON.parse(data.toString()));
        });
        
        peer.on('error', err => console.error("WebRTC peer error:", err));
    }
    
    async _handleMetadata(metadata) {
        if (metadata.type === 'init') {
            // First message with MIME type and key
            console.log("Received init metadata:", metadata.mimeType);
            this.encryptionKey = await CryptoUtils.importKey(metadata.encryptionKey);
            this.player = new Player(document.getElementById('remoteVideo'), metadata.mimeType);
            document.querySelector('#status').textContent = 'Streaming';
        } else if (metadata.type === 'chunk' && this.encryptionKey) {
            const { index, iv, timestamp } = metadata;
            
            // Prioritize downloading latest chunks
            if (index >= this.nextChunkIndex) {
                 this.pendingChunks.set(index, { iv, timestamp });
                 // WebTorrent's default piece selection is not ideal for live streaming.
                 // This is a simplified approach; a more advanced implementation
                 // would use a custom piece selection strategy.
                 this.torrent.select(index, index, true); // Prioritize this piece
            }
        }
    }
    
    async _handlePiece(index, buffer) {
        const metadata = this.pendingChunks.get(index);
        if (!metadata) return; // Received a piece we didn't have metadata for

        try {
            const decryptedChunk = await CryptoUtils.decrypt(buffer, this.encryptionKey, new Uint8Array(metadata.iv));
            
            this.player.append(decryptedChunk);
            this.pendingChunks.delete(index);
            this.nextChunkIndex = index + 1;
            
            // Calculate latency
            this.latency = Date.now() - metadata.timestamp;

            // Autoplay video
            const remoteVideo = document.getElementById('remoteVideo');
            if(remoteVideo.paused) {
                remoteVideo.play().catch(e => console.warn("Autoplay failed:", e));
            }

        } catch (e) {
            console.error(`Decryption failed for chunk ${index}:`, e);
        }
    }
}
