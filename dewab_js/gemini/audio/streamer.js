/**
 * AudioStreamer manages real-time audio playback from a stream of PCM audio chunks.
 * It implements a sophisticated buffering system to ensure smooth playback while
 * handling network jitter and maintaining low latency. The streamer uses Web Audio API
 * for precise timing and efficient audio scheduling.
 */
import { MODEL_SAMPLE_RATE } from '../gemini-config.js';
import { Logger, PCM16toString, stringToPCM16 } from '../gemini-utils.js';

export class AudioStreamer {
    /**
     * Creates an AudioStreamer instance with the specified audio context
     * @param {AudioContext} context - Web Audio API context for audio playback
     */
    constructor(context) {
        if (!context || !(context instanceof AudioContext)) {
            throw new Error('Invalid AudioContext provided', { context });
        }
        this.context = context;
        this.audioQueue = [];                           // Queue of audio chunks waiting to be played
        this.isPlaying = false;                         // Playback state
        this._sampleRate = MODEL_SAMPLE_RATE;           // Revert to MODEL_SAMPLE_RATE for playback
        this.bufferSize = Math.floor(this._sampleRate * 0.32);  // Buffer size (320ms based on sample rate)
        this.processingBuffer = new Float32Array(0);    // Accumulator for incomplete chunks
        this.scheduledTime = 0;                         // Next scheduled audio playback time
        this.gainNode = this.context.createGain();      // Volume control node
        this.isStreamComplete = false;                  // Stream completion flag
        this.checkInterval = null;                      // Interval for checking buffer state
        this.initialBufferTime = 0.05;                  // Initial buffering delay (50ms)
        this.isInitialized = false;                     // Initialization state
        this.endOfQueueAudioSource = null;              // Last audio source in queue
        this.scheduledSources = new Set();              // Track active audio sources
        
        // Connect gain node to audio output
        this.gainNode.connect(this.context.destination);
        Logger.info('AudioStreamer', 'AudioStreamer initialized', { sampleRate: this._sampleRate });
        
        // Bind methods
        this.streamAudio = this.streamAudio.bind(this);
    }

    /**
     * Gets the current sample rate used for audio playback
     * @returns {number} Current sample rate in Hz
     */
    get sampleRate() {
        return this._sampleRate;
    }

    /**
     * Sets a new sample rate and adjusts buffer size accordingly
     * @param {number} value - New sample rate in Hz
     */
    set sampleRate(value) {
        if (!Number.isFinite(value) || value <= 1 || value > 48000) {
            Logger.warn('AudioStreamer', 'Attempt to set invalid sample rate:' + value + '. Must be between 1 and 48000Hz. Using saved sample rate instead:' + this._sampleRate);
            return;
        }
        this._sampleRate = value;
        this.bufferSize = Math.floor(value * 0.32);  // 320ms buffer
        Logger.info('AudioStreamer', 'Sample rate updated', { newRate: value, newBufferSize: this.bufferSize });
    }

    /**
     * Processes incoming PCM16 audio chunks for playback
     * @param {Int16Array|Uint8Array} chunk - Raw PCM16 audio data
     */
    async streamAudio(chunk) {
        if (!this.isInitialized) {
            Logger.warn('AudioStreamer', 'Streamer not initialized, cannot play audio. Please call initialize() first.');
            return;
        }

        if (this.isStreamComplete) {
            // This means new audio is arriving after we thought the stream was done.
            // Reset the stream complete flag and clear the start time for the new stream.
            Logger.info('AudioStreamer', 'New audio stream started, isStreamComplete reset.');
            this.isStreamComplete = false;
            this.scheduledTime = this.context.currentTime + this.initialBufferTime; // Reset start time for the new stream
            this.processingBuffer = new Float32Array(0); // Clear any remnants from previous stream
        }

        if (!chunk || !(chunk instanceof Int16Array || chunk instanceof Uint8Array)) {
            Logger.warn('AudioStreamer', 'Invalid audio chunk provided', { chunkType: chunk ? chunk.constructor.name : 'null' });
            return;
        }

        try {
            // Convert Int16 samples to Float32 format
            const float32Array = new Float32Array(chunk.length / 2);
            const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

            for (let i = 0; i < chunk.length / 2; i++) {
                const int16 = dataView.getInt16(i * 2, true);
                float32Array[i] = int16 / 32768;  // Scale to [-1.0, 1.0] range
            }

            // Limit processing buffer size to prevent memory issues
            if (this.processingBuffer.length > this.bufferSize * 4) {
                Logger.warn('AudioStreamer', 'Processing buffer overflow, resetting', { 
                    bufferSize: this.processingBuffer.length,
                    maxSize: this.bufferSize * 4 
                });
                this.processingBuffer = new Float32Array(0);
            }

            // Accumulate samples in processing buffer
            const newBuffer = new Float32Array(this.processingBuffer.length + float32Array.length);
            newBuffer.set(this.processingBuffer);
            newBuffer.set(float32Array, this.processingBuffer.length);
            this.processingBuffer = newBuffer;

            // Split processing buffer into playable chunks
            while (this.processingBuffer.length >= this.bufferSize) {
                const buffer = this.processingBuffer.slice(0, this.bufferSize);
                this.audioQueue.push(buffer);
                this.processingBuffer = this.processingBuffer.slice(this.bufferSize);
            }

            // Start playback if not already playing
            if (!this.isPlaying) {
                // Try to resume context if suspended (this will only work after user gesture)
                if (this.context.state === 'suspended') {
                    try {
                        await this.context.resume();
                        Logger.info('AudioStreamer', 'AudioContext resumed for playback');
                        // Reset scheduledTime after resume since context time may have jumped
                        this.scheduledTime = this.context.currentTime + this.initialBufferTime;
                    } catch (error) {
                        Logger.warn('AudioStreamer', 'Could not resume AudioContext for playback:', error);
                        // Continue anyway - audio won't play but won't crash
                    }
                } else {
                    // Context is already running, ensure we have a proper start time
                    this.scheduledTime = Math.max(this.scheduledTime, this.context.currentTime + this.initialBufferTime);
                }
                
                this.isPlaying = true;
                this.scheduleNextBuffer();
            }
        } catch (error) {
            Logger.error('AudioStreamer', 'Error processing audio chunk:' + error);
        }
    }

    /**
     * Creates an AudioBuffer from Float32 audio data
     * @param {Float32Array} audioData - Audio samples to convert
     * @returns {AudioBuffer} Web Audio API buffer for playback
     */
    createAudioBuffer(audioData) {
        const audioBuffer = this.context.createBuffer(1, audioData.length, this.sampleRate);
        audioBuffer.getChannelData(0).set(audioData);
        return audioBuffer;
    }

    /**
     * Schedules audio buffers for playback with precise timing
     * Implements a look-ahead scheduler to ensure smooth playback
     * Uses setTimeout for efficient CPU usage while maintaining timing accuracy
     */
    scheduleNextBuffer() {
        if (!this.isPlaying) return;  // Don't schedule if stopped

        const SCHEDULE_AHEAD_TIME = 0.2;  // Look-ahead window in seconds

        try {
            // Schedule buffers within look-ahead window
            while (this.audioQueue.length > 0 && this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME) {
                const audioData = this.audioQueue.shift();
                const audioBuffer = this.createAudioBuffer(audioData);
                const source = this.context.createBufferSource();

                // Track this source
                this.scheduledSources.add(source);
                source.onended = () => {
                    this.scheduledSources.delete(source);
                };

                // Handle completion tracking for last buffer
                if (this.audioQueue.length === 0) {
                    if (this.endOfQueueAudioSource) {
                        this.endOfQueueAudioSource.onended = null;
                    }
                    this.endOfQueueAudioSource = source;
                    source.onended = () => {
                        this.scheduledSources.delete(source);
                        if (!this.audioQueue.length && this.endOfQueueAudioSource === source) {
                            this.endOfQueueAudioSource = null;
                        }
                    };
                }

                source.buffer = audioBuffer;
                source.connect(this.gainNode);

                // Ensure accurate playback timing
                const startTime = Math.max(this.scheduledTime, this.context.currentTime);
                source.start(startTime);
                this.scheduledTime = startTime + audioBuffer.duration;
            }

            // Handle buffer underrun or stream completion
            if (this.audioQueue.length === 0 && this.processingBuffer.length === 0) {
                if (this.isStreamComplete) {
                    this.isPlaying = false;
                    if (this.checkInterval) {
                        clearInterval(this.checkInterval);
                        this.checkInterval = null;
                    }
                    Logger.info('AudioStreamer', 'Playback stopped due to stream completion and empty queue.');
                } else if (!this.checkInterval) {
                    // Start checking for new audio data
                    this.checkInterval = window.setInterval(() => {
                        if (this.audioQueue.length > 0 || this.processingBuffer.length >= this.bufferSize) {
                            this.scheduleNextBuffer();
                        }
                    }, 100);
                }
            } else {
                // Schedule next check based on audio timing
                const nextCheckTime = (this.scheduledTime - this.context.currentTime) * 1000;
                setTimeout(() => this.scheduleNextBuffer(), Math.max(0, nextCheckTime - 50));
            }
        } catch (error) {
            Logger.error('AudioStreamer', 'Error scheduling next buffer:' + error);
        }
    }

    /**
     * Stops audio playback and cleans up resources
     * Implements smooth fade-out and resets audio pipeline
     */
    stop() {
        Logger.info('AudioStreamer', 'Stopping audio playback');
        this.isPlaying = false;
        this.isStreamComplete = true;
        
        // Stop all active audio sources
        for (const source of this.scheduledSources) {
            try {
                source.stop();
                source.disconnect();
            } catch (error) {
                Logger.debug('AudioStreamer', 'Error stopping audio source', { error: error });
            }
        }
        this.scheduledSources.clear();
        
        this.audioQueue = [];
        this.processingBuffer = new Float32Array(0);
        this.scheduledTime = this.context.currentTime;

        // Clear buffer check interval
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        // Fade out audio to avoid clicks
        try {
            if (this.gainNode) {
                this.gainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.1);
            }
        } catch (error) {
            Logger.error('AudioStreamer', 'Error during fade-out:' + error);
        }
    }

    /**
     * Initializes the audio streamer
     * Ensures audio context is active before starting playback
     * @returns {AudioStreamer} This instance for method chaining
     */
    async initialize() {
        if (this.isInitialized) return;
        try {
            if (this.context.state === 'suspended') {
                Logger.info('AudioStreamer', 'AudioContext is suspended, will need user gesture to resume...');
                // Don't try to resume here - it will hang if no user gesture has occurred
                // Don't set scheduledTime yet - it will be set properly when context resumes
                this.scheduledTime = 0;
            } else {
                // Context is running, set proper scheduled time
                this.scheduledTime = this.context.currentTime + this.initialBufferTime;
            }
            
            this.isStreamComplete = false;
            this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
            this.isInitialized = true;

            Logger.info('AudioStreamer', 'AudioStreamer initialization complete');
        } catch (error) {
            Logger.error('AudioStreamer', 'Failed to initialize AudioStreamer:', error);
            this.isInitialized = false; // Ensure it's marked as not initialized if resume fails
            throw error; // Re-throw so the caller knows initialization failed
        }
    }

    /**
     * Signals that the audio stream has completed.
     * Any remaining buffered audio will be scheduled for playback.
     */
    markStreamComplete() {
        Logger.info('AudioStreamer', 'Audio stream marked as complete.');
        this.isStreamComplete = true;
        if (this.processingBuffer.length > 0) {
            this.audioQueue.push(this.processingBuffer.slice(0)); // Push a copy
            this.processingBuffer = new Float32Array(0); // Clear processing buffer
            Logger.info('AudioStreamer', 'Flushed remaining processingBuffer on markStreamComplete.');
        }
        // If not playing but there's now audio in the queue, or if it was already playing, 
        // ensure scheduleNextBuffer is called to process any newly added (final) chunk.
        // This check prevents starting playback if it was intentionally stopped and then marked complete.
        if (this.isPlaying && this.audioQueue.length > 0) {
             // Call scheduleNextBuffer directly if it's not already in a loop or to expedite
            this.scheduleNextBuffer(); 
        } else if (!this.isPlaying && this.audioQueue.length > 0) {
            // If it wasn't playing, but now has a final chunk, start it.
            this.isPlaying = true;
            // Ensure scheduledTime is appropriate, it might have been a while since last audio
            this.scheduledTime = Math.max(this.scheduledTime, this.context.currentTime + this.initialBufferTime);
            this.scheduleNextBuffer();
        }
    }
} 