import { arrayBufferToBase64, Logger } from '../gemini-utils.js';

/**
 * AudioRecorder manages the capture and processing of audio input from the user's microphone.
 * It uses the Web Audio API and AudioWorklet to process audio in real-time with minimal latency.
 * The processed audio is converted to base64-encoded Int16 format suitable for transmission.
 */
export class AudioRecorder extends EventTarget {
    /**
     * Creates an AudioRecorder instance
     * @param {AudioContext} audioContext - Web Audio API context for audio processing
     */
    constructor(audioContext) {
        super();
        // Core audio configuration
        this.audioContext = audioContext; // AudioContext for Web Audio API
        // Ensure recorder uses 16kHz. The provided audioContext should ideally also be 16kHz.
        this.sampleRate = 16000; 
        this.stream = null;              // MediaStream from getUserMedia
        this.source = null;              // MediaStreamAudioSourceNode
        this.processor = null;           // AudioWorkletNode for processing
        this.onAudioData = null;         // Callback for processed audio chunks
        this.isRecording = false;        // Recording state flag
        this.isSuspended = false;        // Mic suspension state
        this.moduleAdded = false;        // Flag to track if the AudioWorklet module has been added
        this.analyser = null;            // AudioAnalyser for audio level monitoring
        this.dataArray = null;           // Uint8Array for audio level data
    }

    /**
     * Initializes and starts audio capture pipeline
     * Sets up audio context, worklet processor, and media stream
     * @param {Function} onAudioData - Callback receiving base64-encoded audio chunks
     */
    async start(onAudioData) {
        this.onAudioData = onAudioData;
        try {
            // Request microphone access with specific echo cancelation and noise reduction
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,  // Changed to 16kHz to match Gemini's expectations
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            Logger.debug('[AudioRecorder]', 'Media stream created successfully');
            
            // Ensure the audio context is active
            if (this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                    Logger.debug('[AudioRecorder]', 'AudioContext resumed');
                } catch (resumeError) {
                    Logger.error('[AudioRecorder]', 'Failed to resume audio context. User gesture might be required.', resumeError);
                    throw new Error('AudioContext requires user gesture to resume. ' + resumeError.message);
                }
            }

            // Load the audio worklet for processing
            await this.audioContext.audioWorklet.addModule('../dewab/gemini/audio/worklets/audio-processor.js');

            // Create processor node and connect stream
            this.source = this.audioContext.createMediaStreamSource(this.stream);
            // Instantiate without processorOptions, assuming worklet defaults or is designed for 16kHz.
            this.processor = new AudioWorkletNode(this.audioContext, 'audio-recorder-worklet'); 
            this.source.connect(this.processor);

            // Handle processed audio data
            this.processor.port.onmessage = (event) => {
                try {
                    if (event.data.event === 'chunk' && this.onAudioData) {
                        // Convert the Int16Array buffer to base64
                        const base64Data = arrayBufferToBase64(event.data.data.int16arrayBuffer);
                        this.onAudioData(base64Data);
                    } else if (event.data.event === 'error') {
                        Logger.error('[AudioRecorder]', 'Worklet error:', event.data.error);
                    }
                } catch (error) {
                    Logger.error('[AudioRecorder]', 'Error handling worklet message:', error);
                }
            };

            this.isRecording = true;
            Logger.debug('[AudioRecorder]', 'Recording started successfully');
            
        } catch (error) {
            Logger.error('[AudioRecorder]', 'Failed to start recording:', error);
            throw new Error('Failed to start audio recording: ' + error.message);
        }
    }

    /**
     * Gracefully stops audio recording and cleans up resources
     */
    stop() {
        try {
            if (!this.isRecording) {
                Logger.debug('[AudioRecorder]', 'Already stopped');
                return;
            }

            // Send flush command to worklet before stopping tracks
            if (this.processor) {
                this.processor.port.postMessage({ command: 'flush' });
            }

            // Stop all active media tracks
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }

            this.isRecording = false;

            // Disconnect nodes and clean up
            if (this.processor) {
                this.processor.disconnect();
                this.processor = null;
            }
            if (this.source) {
                this.source.disconnect();
                this.source = null;
            }
            
            Logger.info('[AudioRecorder]', 'Recording stopped successfully');
            
        } catch (error) {
            Logger.error('[AudioRecorder]', 'Error stopping recording:', error);
            throw new Error('Failed to stop audio recording: ' + error.message);
        }
    }

    /**
     * Suspends microphone input without destroying the audio context
     */
    async suspendMic() {
        if (!this.isRecording || this.isSuspended) return;
        
        try {
            await this.audioContext.suspend();
            this.stream.getTracks().forEach(track => track.enabled = false);
            this.isSuspended = true;
            Logger.info('[AudioRecorder]', 'Microphone suspended');
        } catch (error) {
            throw new Error('Failed to suspend microphone:' + error);
        }
    }

    /**
     * Resumes microphone input if previously suspended
     */
    async resumeMic() {
        if (!this.isRecording || !this.isSuspended) return;
        
        try {
            await this.audioContext.resume();
            this.stream.getTracks().forEach(track => track.enabled = true);
            this.isSuspended = false;
            Logger.info('[AudioRecorder]', 'Microphone resumed');
        } catch (error) {
            throw new Error('Failed to resume microphone:' + error);
        }
    }

    /**
     * Toggles microphone state between suspended and active
     */
    async toggleMic() {
        if (this.isSuspended) {
            await this.resumeMic();
        } else {
            await this.suspendMic();
        }
    }
} 