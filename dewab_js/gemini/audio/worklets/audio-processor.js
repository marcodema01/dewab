/**
 * AudioProcessingWorklet handles real-time audio processing in a dedicated thread.
 * It converts incoming Float32 audio samples to Int16 format for efficient network transmission
 * and processing by speech recognition systems.
 */
class AudioProcessingWorklet extends AudioWorkletProcessor {
    /**
     * Initializes the audio processing worklet with a fixed-size buffer
     * Buffer size of 2048 samples provides a good balance between latency and processing efficiency
     */
    constructor(options) {
        super();
        this.buffer = new Int16Array(2048);
        this.bufferWriteIndex = 0;
        this.sampleRate = 16000;
        
        const ts = () => new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + new Date().getMilliseconds().toString().padStart(3, '0');
        console.log(`[${ts()}] [AudioProcessingWorklet] Initialized (no VAD). Processing sample rate: ${this.sampleRate}Hz.`);

        this.port.onmessage = (event) => {
            if (event.data.command === 'flush') {
                if (this.bufferWriteIndex > 0) {
                    this.sendAndClearBuffer();
                }
            }
        };
    }
    
    /**
     * Processes incoming audio data in chunks
     * @param {Array<Float32Array[]>} inputs - Array of input channels, each containing Float32 audio samples
     * @returns {boolean} - Return true to keep the processor alive
     */
    process(inputs) {
        if (!inputs[0] || !inputs[0][0] || inputs[0][0].length === 0) {
            return true; // Keep processor alive if no input
        }
        const channel0 = inputs[0][0];
        this.processChunk(channel0); // Process all incoming audio
        return true;
    }

    /**
     * Sends the accumulated audio buffer to the main thread and resets the write position
     * Uses SharedArrayBuffer for zero-copy transfer of audio data
     */
    sendAndClearBuffer() {
        this.port.postMessage({
            event: 'chunk',
            data: {
                // Transfer only the filled portion of the buffer
                int16arrayBuffer: this.buffer.slice(0, this.bufferWriteIndex).buffer,
            },
        });
        this.bufferWriteIndex = 0;
    }

    /**
     * Converts Float32 audio samples to Int16 format and accumulates them in the buffer
     * Float32 range [-1.0, 1.0] is mapped to Int16 range [-32768, 32767]
     * @param {Float32Array} float32Array - Input audio samples in Float32 format
     */
    processChunk(float32Array) {
        try {
            for (let i = 0; i < float32Array.length; i++) {
                // Convert Float32 to Int16 with proper rounding and clamping
                const int16Value = Math.max(-32768, Math.min(32767, Math.floor(float32Array[i] * 32768)));
                this.buffer[this.bufferWriteIndex++] = int16Value;

                // Send buffer when full to maintain continuous audio stream
                if (this.bufferWriteIndex >= this.buffer.length) {
                    this.sendAndClearBuffer();
                }
            }
        } catch (error) {
            // Forward processing errors to main thread for handling
            this.port.postMessage({
                event: 'error',
                error: {
                    message: error.message,
                    stack: error.stack
                }
            });
        }
    }
}

// Register the worklet processor with a unique name for reference in AudioWorkletNode
registerProcessor('audio-recorder-worklet', AudioProcessingWorklet); 