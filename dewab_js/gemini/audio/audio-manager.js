import { AudioRecorder } from './recorder.js';
import { AudioStreamer } from './streamer.js';
import { MODEL_SAMPLE_RATE } from '../gemini-config.js';
import { Logger } from '../gemini-utils.js';
import { EventEmitter } from 'https://cdn.skypack.dev/eventemitter3';

/**
 * AudioManager handles all audio-related functionality for the Gemini system.
 * This includes audio recording, streaming, context management, and microphone state.
 * 
 * Extracted from GeminiAgent to improve maintainability and separation of concerns.
 * Emits events that the GeminiAgent can listen to and forward appropriately.
 */
export class AudioManager extends EventEmitter {
    /**
     * Creates an AudioManager instance
     */
    constructor() {
        super();
        
        // Audio components
        this.audioContext = null;
        this.audioRecorder = null;
        this.audioStreamer = null;
        
        // State management
        this.isInitialized = false;
        this.isListening = false;
        this.onAudioDataCallback = null;
        
        Logger.info('AudioManager', 'AudioManager instance created');
    }

    /**
     * Resumes the audio context if it's suspended.
     * This must be called after a user gesture.
     * @returns {Promise<void>}
     */
    async resumeAudioContext() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                Logger.info('AudioManager', 'AudioContext resumed successfully.');
            } catch (error) {
                Logger.error('AudioManager', 'Failed to resume AudioContext:', error);
                throw error;
            }
        }
    }

    /**
     * Initializes the audio system with AudioContext and components
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.isInitialized) {
            Logger.debug('AudioManager', 'Already initialized');
            return;
        }

        Logger.info('AudioManager', 'Initializing audio system...');

        try {
            // Create audio context at MODEL_SAMPLE_RATE for playback
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: MODEL_SAMPLE_RATE 
            });
            
            if (this.audioContext.state === 'suspended') {
                // Don't await resume here. It must be user-initiated.
                Logger.warn('AudioManager', 'AudioContext is suspended. It must be resumed by a user gesture.');
            }

            // Initialize audio components
            this.audioRecorder = new AudioRecorder(this.audioContext);
            this.audioStreamer = new AudioStreamer(this.audioContext);
            await this.audioStreamer.initialize();

            this.isInitialized = true;
            Logger.info('AudioManager', 'Audio system initialized successfully');
            this.emit('status_update', { 
                message: 'Audio system initialized', 
                initialized: true, 
                microphoneActive: this.isListening 
            });
            
        } catch (error) {
            Logger.error('AudioManager', 'Error initializing audio system:', error);
            this.emit('error', { 
                context: 'audio_initialization', 
                message: `Failed to initialize audio: ${error.message}`,
                errorObj: error 
            });
            // Don't re-throw, allow text-only to function
            // throw error;
        }
    }

    /**
     * Starts audio recording with a callback for audio data
     * @param {Function} onAudioData - Callback function to receive base64 audio chunks
     * @returns {Promise<void>}
     */
    async startRecording(onAudioData) {
        await this.resumeAudioContext(); // Ensure context is running

        if (this.isListening) {
            Logger.warn('AudioManager', "Already recording");
            return;
        }
        
        if (!this.isInitialized) {
            throw new Error('AudioManager not initialized');
        }
        
        if (!this.audioRecorder) {
            throw new Error('AudioRecorder not available');
        }

        try {
            this.onAudioDataCallback = onAudioData;
            
            await this.audioRecorder.start((audioData) => {
                if (this.onAudioDataCallback) {
                    this.onAudioDataCallback(audioData);
                }
            });
            
            this.isListening = true;
            this.emit('status_update', { 
                microphoneActive: true, 
                message: 'Microphone activated' 
            });
            
            Logger.info('AudioManager', 'Recording started successfully');
            
        } catch (error) {
            Logger.error('AudioManager', 'Failed to start recording:', error);
            this.isListening = false;
            this.emit('error', { 
                context: 'recording_start', 
                message: error.message, 
                errorObj: error 
            });
            throw error;
        }
    }

    /**
     * Stops audio recording
     * @returns {Promise<void>}
     */
    async stopRecording() {
        if (!this.isListening) {
            Logger.warn('AudioManager', "Not recording");
            return;
        }

        try {
            if (this.audioRecorder && this.audioRecorder.isRecording) {
                this.audioRecorder.stop();
            }
            
            this.isListening = false;
            this.onAudioDataCallback = null;
            
            this.emit('status_update', { 
                microphoneActive: false, 
                message: 'Microphone deactivated' 
            });
            this.emit('recording_stopped');
            
            Logger.info('AudioManager', 'Recording stopped successfully');
            
        } catch (error) {
            Logger.error('AudioManager', 'Failed to stop recording:', error);
            this.emit('error', { 
                context: 'recording_stop', 
                message: error.message, 
                errorObj: error 
            });
            throw error;
        }
    }

    /**
     * Toggles microphone recording on/off
     * @param {Function} onAudioData - Callback function for audio data (used when starting)
     * @returns {Promise<void>}
     */
    async toggleMicrophone(onAudioData) {
        if (!this.isInitialized) {
            Logger.info('AudioManager', "Audio system not initialized. Attempting to initialize...");
            await this.initialize();
        }

        if (this.isListening) {
            await this.stopRecording();
        } else {
            await this.startRecording(onAudioData);
        }
    }

    /**
     * Streams audio data for playback
     * @param {Uint8Array} audioData - PCM audio data to stream
     */
    async streamAudio(audioData) {
        if (!this.audioStreamer) {
            Logger.warn('AudioManager', 'AudioStreamer not available');
            return;
        }

        try {
            if (!this.audioStreamer.isInitialized) {
                await this.audioStreamer.initialize();
            }
            
            await this.audioStreamer.streamAudio(audioData);
            this.emit('audio_chunk_played', audioData);
            
        } catch (error) {
            Logger.error('AudioManager', 'Audio streaming error:', error);
            this.emit('error', { 
                context: 'audio_streaming', 
                message: error.message, 
                errorObj: error 
            });
        }
    }

    /**
     * Marks the audio stream as complete
     */
    markStreamComplete() {
        if (this.audioStreamer) {
            this.audioStreamer.markStreamComplete();
            Logger.info('AudioManager', 'Audio stream marked as complete');
        }
    }

    /**
     * Stops audio playback
     */
    stopPlayback() {
        if (this.audioStreamer) {
            this.audioStreamer.stop();
            this.audioStreamer.isInitialized = false;
            Logger.info('AudioManager', 'Audio playback stopped');
        }
    }

    /**
     * Cleans up all audio resources
     * @returns {Promise<void>}
     */
    async cleanup() {
        Logger.info('AudioManager', 'Cleaning up audio resources...');
        
        // Stop recording
        if (this.audioRecorder && this.audioRecorder.isRecording) {
            try {
                this.audioRecorder.stop();
            } catch (error) {
                Logger.error('AudioManager', "Error stopping recorder during cleanup:", error);
            }
        }

        // Stop audio streamer
        if (this.audioStreamer) {
            try {
                this.audioStreamer.stop();
            } catch (error) {
                Logger.error('AudioManager', "Error stopping audio streamer:", error);
            }
        }

        // Close audio context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            try {
                await this.audioContext.close();
            } catch (error) {
                Logger.error('AudioManager', "Error closing audio context:", error);
            }
        }

        // Clean up references
        this.audioContext = null;
        this.audioRecorder = null;
        this.audioStreamer = null;
        this.isListening = false;
        this.isInitialized = false;
        this.onAudioDataCallback = null;

        Logger.info('AudioManager', 'Audio cleanup completed');
    }

    /**
     * Gets the current microphone state
     * @returns {boolean}
     */
    get isMicrophoneActive() {
        return this.isListening;
    }

    /**
     * Gets the initialization state
     * @returns {boolean}
     */
    get initialized() {
        return this.isInitialized;
    }

    /**
     * Gets the current audio status
     * @returns {object}
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            microphoneActive: this.isListening,
            audioContextState: this.audioContext?.state || 'not_created',
            recorderAvailable: !!this.audioRecorder,
            streamerAvailable: !!this.audioStreamer
        };
    }
} 