import { EventEmitter } from 'https://cdn.skypack.dev/eventemitter3';
import { Logger } from '../gemini-utils.js';

/**
 * VoiceChatHandler manages voice-based conversation features.
 * It handles audio processing, transcription accumulation, and voice-specific turn management.
 * 
 * Events emitted:
 * - 'audio_received': Audio data received from API
 * - 'user_transcription': User speech transcription
 * - 'transcription_accumulated': Gemini speech transcription accumulated
 * - 'transcription_complete': Complete transcription ready
 * - 'turn_complete_voice': Voice portion of turn completed
 */
export class VoiceChatHandler extends EventEmitter {
    /**
     * Creates a new VoiceChatHandler instance
     * @param {string} [name='VoiceChatHandler'] - Name for logging purposes
     */
    constructor(name = 'VoiceChatHandler') {
        super();
        
        this.name = name;
        this.accumulatedTranscription = '';
        this.isTranscribing = false;
        this.audioChunksReceived = 0;
        this.transcriptionChunksReceived = 0;
        
        Logger.debug(this.name, 'VoiceChatHandler initialized');
    }

    /**
     * Processes audio content from model turn parts
     * @param {Array} audioParts - Array of audio parts from model turn
     */
    processAudioParts(audioParts) {
        if (!Array.isArray(audioParts) || audioParts.length === 0) {
            return;
        }

        audioParts.forEach(part => {
            if (part.inlineData?.data && part.inlineData?.mimeType) {
                this.audioChunksReceived++;
                
                Logger.debug(this.name, `Processing audio chunk #${this.audioChunksReceived}:`, {
                    mimeType: part.inlineData.mimeType,
                    dataLength: part.inlineData.data.length
                });
                
                this.emit('audio_received', {
                    mimeType: part.inlineData.mimeType,
                    data: part.inlineData.data,
                    chunkNumber: this.audioChunksReceived
                });
            }
        });
    }

    /**
     * Processes user input transcription
     * @param {string} transcriptionText - User speech transcription
     */
    processUserTranscription(transcriptionText) {
        if (!transcriptionText || typeof transcriptionText !== 'string') {
            return;
        }

        Logger.debug(this.name, `User transcription: "${transcriptionText}"`);
        
        this.emit('user_transcription', {
            text: transcriptionText,
            timestamp: new Date().toISOString(),
            source: 'user'
        });
        
        return transcriptionText;
    }

    /**
     * Processes Gemini output transcription chunks
     * @param {string} transcriptionText - Gemini speech transcription chunk
     */
    processGeminiTranscription(transcriptionText) {
        if (!transcriptionText || typeof transcriptionText !== 'string') {
            return;
        }

        this.isTranscribing = true;
        this.transcriptionChunksReceived++;
        
        // Accumulate transcription
        this.accumulatedTranscription += transcriptionText;
        
        Logger.debug(this.name, `Gemini transcription chunk #${this.transcriptionChunksReceived}: "${transcriptionText}"`);
        Logger.debug(this.name, `Accumulated transcription: "${this.accumulatedTranscription}"`);
        
        this.emit('transcription_accumulated', {
            chunk: transcriptionText,
            accumulated: this.accumulatedTranscription,
            chunkNumber: this.transcriptionChunksReceived,
            length: this.accumulatedTranscription.length
        });
        
        return this.accumulatedTranscription;
    }

    /**
     * Handles voice-specific turn completion
     * @returns {object|null} Voice results if any, null if no voice content
     */
    completeTurn() {
        let result = null;
        
        if (this.isTranscribing && this.accumulatedTranscription.trim()) {
            const transcriptionResult = this.accumulatedTranscription.trim();
            
            Logger.debug(this.name, `Voice turn complete - transcription: "${transcriptionResult}"`);
            
            result = {
                transcription: transcriptionResult,
                audioChunks: this.audioChunksReceived,
                transcriptionChunks: this.transcriptionChunksReceived
            };
            
            this.emit('transcription_complete', transcriptionResult);
            this.emit('turn_complete_voice', result);
        }
        
        // Reset state
        this.accumulatedTranscription = '';
        this.isTranscribing = false;
        this.transcriptionChunksReceived = 0;
        
        return result;
    }

    /**
     * Resets the voice processing state
     */
    reset() {
        const hadContent = this.accumulatedTranscription.length > 0 || this.audioChunksReceived > 0;
        
        this.accumulatedTranscription = '';
        this.isTranscribing = false;
        this.audioChunksReceived = 0;
        this.transcriptionChunksReceived = 0;
        
        if (hadContent) {
            Logger.debug(this.name, 'Voice processing state reset');
        }
    }

    /**
     * Gets the current voice processing state
     * @returns {object} Current voice state
     */
    getState() {
        return {
            accumulatedTranscription: this.accumulatedTranscription,
            transcriptionLength: this.accumulatedTranscription.length,
            isTranscribing: this.isTranscribing,
            audioChunksReceived: this.audioChunksReceived,
            transcriptionChunksReceived: this.transcriptionChunksReceived,
            hasContent: this.accumulatedTranscription.trim().length > 0 || this.audioChunksReceived > 0
        };
    }

    /**
     * Checks if handler is currently processing voice content
     * @returns {boolean} True if actively processing voice
     */
    isProcessing() {
        return this.isTranscribing || this.audioChunksReceived > 0;
    }

    /**
     * Gets current accumulated transcription without resetting state
     * @returns {string} Current accumulated transcription
     */
    getCurrentTranscription() {
        return this.accumulatedTranscription;
    }

    /**
     * Gets voice processing statistics
     * @returns {object} Processing statistics
     */
    getStats() {
        return {
            transcriptionLength: this.accumulatedTranscription.length,
            transcriptionWords: this.accumulatedTranscription.trim().split(/\s+/).length,
            audioChunksReceived: this.audioChunksReceived,
            transcriptionChunksReceived: this.transcriptionChunksReceived,
            isTranscribing: this.isTranscribing,
            avgChunkSize: this.transcriptionChunksReceived > 0 ? 
                Math.round(this.accumulatedTranscription.length / this.transcriptionChunksReceived) : 0
        };
    }

    /**
     * Processes a complete transcription (non-streaming)
     * @param {string} transcription - Complete transcription
     * @param {string} [source='gemini'] - Source of transcription
     */
    processCompleteTranscription(transcription, source = 'gemini') {
        if (!transcription || typeof transcription !== 'string') {
            return;
        }

        Logger.debug(this.name, `Processing complete ${source} transcription: "${transcription}"`);
        
        if (source === 'user') {
            this.emit('user_transcription', {
                text: transcription,
                timestamp: new Date().toISOString(),
                source: 'user'
            });
        } else {
            this.emit('transcription_complete', transcription);
        }
        
        return transcription;
    }
} 