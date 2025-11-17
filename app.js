// =============================================================================
//  Main Application Logic (app.js) - FINAL CORRECTED VERSION
// =============================================================================
// FIX: The entire script is wrapped in a DOMContentLoaded listener.
// This is the most important fix, guaranteeing that all HTML is parsed and
// all deferred scripts (WebTorrent, SimplePeer) are loaded and ready
// before our application code tries to use them. This solves the race condition.
document.addEventListener('DOMContentLoaded', () => {

    // FIX: Add explicit checks to ensure libraries loaded correctly.
    if (typeof WebTorrent !== 'function' || typeof SimplePeer !== 'function') {
        alert("A required library (WebTorrent or SimplePeer) failed to load. This can be caused by a network issue or an ad blocker. Please refresh the page or check your browser's console.");
        return;
    }
    if (!WebTorrent.WEBRTC_SUPPORT) {
        alert("Your browser does not support WebRTC, which is required for this application to work.");
        return;
    }

    // --- All application logic is now safely inside this listener ---

    const CONFIG = {
        CHUNK_DURATION: 2000,
        STREAM_MIME_TYPE: 'video/webm; codecs="vp8, opus"',
        TORRENT_FILE_NAME: 'livestream.webm',
        TRACKERS: ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev'],
        RTC_CONFIG: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] }
    };

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

    startStreamBtn.addEventListener('click', async () => {
        if (publisher) return;
        
        startStreamBtn.disabled = true;
        startStreamBtn.textContent = 'Initializing...';
        
        try {
            publisher = new Publisher(CONFIG);
            await publisher.start();
            magnetLinkInput.value = publisher.magnetURI;
            streamInfoDiv.style.display = 'block';
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
            startStreamBtn.disabled = false;
        } finally {
            startStreamBtn.textContent = 'Start Stream';
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
        if(localVideo.srcObject) {
            localVideo.srcObject.getTracks().forEach(track => track.stop());
            localVideo.srcObject = null;
        }
        updateStatus('Idle', 'yellow');
        stopStatsUpdater();
        statsOverlay.style.display = 'none';
    });

    playStreamBtn.addEventListener('click', async () => {
        const magnetURI = magnetInput.value.trim();
        if (!magnetURI.startsWith('magnet:')) {
            return alert("Please enter a valid magnet link.");
        }
        if (viewer) viewer.destroy();

        playStreamBtn.disabled = true;
        playStreamBtn.textContent = 'Connecting...';
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
            startStreamBtn.disabled = false;
            updateStatus('Error', 'red');
        } finally {
            playStreamBtn.textContent = 'Play';
            playStreamBtn.disabled = false;
        }
    });

    copyMagnetBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(magnetLinkInput.value);
            copyMagnetBtn.textContent = 'Copied!';
            setTimeout(() => { copyMagnetBtn.textContent = 'Copy'; }, 2000);
        } catch (err) {
            alert('Could not copy link. Please copy it manually.');
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

    function updateStatus(text, color) { statusEl.textContent = text; statusEl.className = `font-semibold text-${color}-300`; }
    function formatSpeed(bytes) {
        if (bytes === 0) return '0 KB/s';
        const k = 1024, sizes = ['Bytes/s', 'KB/s', 'MB/s', 'GB/s'], i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    function startStatsUpdater() {
        if (statsInterval) clearInterval(statsInterval);
        statsInterval = setInterval(() => {
            const client = publisher?.client || viewer?.client;
            if (!client || client.destroyed) return stopStatsUpdater();
            const torrent = client.torrents[0];
            peerCountEl.textContent = torrent ? torrent.numPeers : 0;
            downloadSpeedEl.textContent = formatSpeed(client.downloadSpeed);
            uploadSpeedEl.textContent = formatSpeed(client.uploadSpeed);
            if (viewer?.latency > 0) latencyEl.textContent = `${viewer.latency.toFixed(0)} ms`;
        }, 1000);
    }
    function stopStatsUpdater() { clearInterval(statsInterval); statsInterval = null; }

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

    class Publisher {
        constructor(config) { this.config = config; this.client = new WebTorrent({ rtcConfig: config.RTC_CONFIG }); this.peers = new Map(); }
        async start() {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
            localVideo.srcObject = this.mediaStream;
            this.encryptionKey = await CryptoUtils.generateKey();
            this.exportedKey = await CryptoUtils.exportKey(this.encryptionKey);
            await new Promise((resolve, reject) => {
                const file = new File([new Uint8Array(1)], this.config.TORRENT_FILE_NAME, { type: this.config.STREAM_MIME_TYPE });
                this.client.seed(file, { announce: this.config.TRACKERS }, torrent => {
                    this.torrent = torrent;
                    this.magnetURI = torrent.magnetURI;
                    this.torrent.pieces = new Array(1e6);
                    this.torrent.length = this.torrent.pieceLength * this.torrent.pieces.length;
                    resolve();
                });
                this.client.on('error', err => reject(err));
            });
            this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType: this.config.STREAM_MIME_TYPE, videoBitsPerSecond: 2500000 });
            this.chunkCounter = 0;
            this.mediaRecorder.ondataavailable = async e => {
                if (e.data.size > 0) {
                    const index = this.chunkCounter++;
                    const data = await e.data.arrayBuffer();
                    const { encryptedData, iv } = await CryptoUtils.encrypt(data, this.encryptionKey);
                    this.torrent.store.put(index, Buffer.from(encryptedData), err => {
                        if (err) return console.error("Error storing piece:", err);
                        this._broadcastMetadata({ type: 'chunk', index, iv: Array.from(iv), timestamp: Date.now() });
                    });
                }
            };
            this.mediaRecorder.start(this.config.CHUNK_DURATION);
            this.torrent.on('wire', wire => this._setupPeer(wire));
        }
        stop() {
            this.mediaRecorder?.stop();
            this.mediaStream?.getTracks().forEach(track => track.stop());
            this.peers.forEach(peer => peer.destroy());
            this.peers.clear();
            if (!this.client.destroyed) this.client.destroy();
        }
        _setupPeer(wire) {
            const peer = new SimplePeer({ initiator: true, trickle: false, config: this.config.RTC_CONFIG });
            peer.on('signal', data => wire.extended('rtc_signal', JSON.stringify(data)));
            wire.on('extended', (ext, payload) => { if (ext === 'rtc_signal') peer.signal(JSON.parse(payload.toString())); });
            peer.on('connect', () => {
                this.peers.set(wire.peerId, peer);
                peer.send(JSON.stringify({ type: 'init', mimeType: this.config.STREAM_MIME_TYPE, encryptionKey: this.exportedKey }));
            });
            const cleanup = () => this.peers.delete(wire.peerId);
            peer.on('close', cleanup);
            peer.on('error', cleanup);
        }
        _broadcastMetadata(data) {
            const msg = JSON.stringify(data);
            this.peers.forEach(p => p.connected && p.send(msg));
        }
    }

    class Player {
        constructor(video, mime) {
            this.video = video; this.queue = []; this.isAppending = false;
            this.mediaSource = new MediaSource();
            this.video.src = URL.createObjectURL(this.mediaSource);
            this.mediaSource.addEventListener('sourceopen', () => {
                this.sourceBuffer = this.mediaSource.addSourceBuffer(mime);
                this.sourceBuffer.addEventListener('updateend', () => { this.isAppending = false; this._processQueue(); });
            });
        }
        append(chunk) { this.queue.push(chunk); if (!this.isAppending) this._processQueue(); }
        _processQueue() {
            if (this.queue.length > 0 && this.sourceBuffer && !this.sourceBuffer.updating) {
                this.isAppending = true;
                try {
                    this.sourceBuffer.appendBuffer(this.queue.shift());
                    const end = this.video.buffered.length ? this.video.buffered.end(this.video.buffered.length - 1) : 0;
                    if (end - this.video.currentTime > 5) this.video.currentTime = end - 0.5;
                } catch (e) { this.isAppending = false; console.error("Buffer append error:", e); }
            }
        }
    }

    class Viewer {
        constructor(config) { this.config = config; this.client = new WebTorrent({ rtcConfig: config.RTC_CONFIG }); this.pendingChunks = new Map(); }
        start(magnet) {
            return new Promise((resolve, reject) => {
                this.torrent = this.client.add(magnet, { announce: this.config.TRACKERS });
                this.torrent.on('wire', wire => this._setupPeer(wire));
                this.torrent.on('piece', (i, buf) => this._handlePiece(i, buf));
                this.torrent.on('error', reject); this.client.on('error', reject);
                setTimeout(() => { if (!this.player) reject(new Error("Connection timed out.")); }, 20000);
            });
        }
        destroy() { if (!this.client.destroyed) this.client.destroy(); }
        _setupPeer(wire) {
            const peer = new SimplePeer({ initiator: false, trickle: false, config: this.config.RTC_CONFIG });
            peer.on('signal', data => wire.extended('rtc_signal', JSON.stringify(data)));
            wire.on('extended', (ext, payload) => { if (ext === 'rtc_signal') peer.signal(JSON.parse(payload.toString())); });
            peer.on('data', data => this._handleMetadata(JSON.parse(data.toString())));
            peer.on('error', err => console.error("WebRTC peer error:", err));
        }
        async _handleMetadata(data) {
            if (data.type === 'init' && !this.player) {
                this.encryptionKey = await CryptoUtils.importKey(data.encryptionKey);
                this.player = new Player(remoteVideo, data.mimeType);
                updateStatus('Streaming', 'green');
            } else if (data.type === 'chunk' && this.encryptionKey) {
                this.pendingChunks.set(data.index, { iv: data.iv, timestamp: data.timestamp });
                this.torrent.select(data.index, data.index, true);
            }
        }
        async _handlePiece(index, buffer) {
            const meta = this.pendingChunks.get(index);
            if (!meta) return;
            try {
                const chunk = await CryptoUtils.decrypt(buffer, this.encryptionKey, new Uint8Array(meta.iv));
                this.player.append(chunk);
                this.pendingChunks.delete(index);
                this.latency = Date.now() - meta.timestamp;
                if (remoteVideo.paused) remoteVideo.play().catch(()=>{});
            } catch (e) { console.error(`Decryption failed for chunk ${index}:`, e); }
        }
    }
});
