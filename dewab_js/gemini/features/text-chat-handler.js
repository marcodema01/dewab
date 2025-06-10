import { EventEmitter } from 'https://cdn.skypack.dev/eventemitter3';
import { Logger } from '../gemini-utils.js';

/**
 * TextChatHandler manages text-based conversation features.
 * It handles text accumulation, processing, and text-specific turn management.
 * 
 * Events emitted:
 * - 'text_accumulated': Text content has been accumulated
 * - 'text_complete': Complete text response ready
 * - 'turn_complete_text': Text portion of turn completed
 */
export class TextChatHandler extends EventEmitter {
    /**
     * Creates a new TextChatHandler instance
     * @param {string} [name='TextChatHandler'] - Name for logging purposes
     */
    constructor(name = 'TextChatHandler') {
        super();
        
        this.name = name;
        this.accumulatedText = '';
        this.isActive = false;
        
        Logger.debug(this.name, 'TextChatHandler initialized');
    }

    /**
     * Processes text content from model turn parts
     * @param {Array} textParts - Array of text parts from model turn
     */
    processTextParts(textParts) {
        if (!Array.isArray(textParts) || textParts.length === 0) {
            return;
        }

        this.isActive = true;
        
        textParts.forEach(part => {
            if (part.text && part.text.trim()) {
                this.accumulatedText += part.text;
                
                Logger.debug(this.name, `Accumulated text chunk: "${part.text}" (total: "${this.accumulatedText}")`);
                
                this.emit('text_accumulated', {
                    chunk: part.text,
                    accumulated: this.accumulatedText,
                    length: this.accumulatedText.length
                });
            }
        });
    }

    /**
     * Handles text-specific turn completion
     * @returns {object|null} Text results if any, null if no text accumulated
     */
    completeTurn() {
        if (!this.isActive || !this.accumulatedText.trim()) {
            return null;
        }

        const textResult = this.accumulatedText.trim();
        Logger.debug(this.name, `Text turn complete: "${textResult}"`);
        
        // Reset state
        this.accumulatedText = '';
        this.isActive = false;
        
        this.emit('text_complete', textResult);
        this.emit('turn_complete_text', textResult);
        
        return textResult;
    }

    /**
     * Processes a complete text message (non-streaming)
     * @param {string} text - Complete text message
     */
    processCompleteText(text) {
        if (!text || typeof text !== 'string') {
            return;
        }

        Logger.debug(this.name, `Processing complete text: "${text}"`);
        
        this.emit('text_complete', text);
        
        return text;
    }

    /**
     * Resets the text accumulation state
     */
    reset() {
        const hadAccumulated = this.accumulatedText.length > 0;
        
        this.accumulatedText = '';
        this.isActive = false;
        
        if (hadAccumulated) {
            Logger.debug(this.name, 'Text accumulation state reset');
        }
    }

    /**
     * Gets the current text accumulation state
     * @returns {object} Current text state
     */
    getState() {
        return {
            accumulatedText: this.accumulatedText,
            textLength: this.accumulatedText.length,
            isActive: this.isActive,
            hasContent: this.accumulatedText.trim().length > 0
        };
    }

    /**
     * Checks if handler is currently processing text
     * @returns {boolean} True if actively processing text
     */
    isProcessing() {
        return this.isActive && this.accumulatedText.length > 0;
    }

    /**
     * Gets accumulated text without resetting state
     * @returns {string} Current accumulated text
     */
    getCurrentText() {
        return this.accumulatedText;
    }

    /**
     * Gets text processing statistics
     * @returns {object} Processing statistics
     */
    getStats() {
        return {
            totalLength: this.accumulatedText.length,
            isActive: this.isActive,
            hasContent: this.accumulatedText.trim().length > 0,
            wordCount: this.accumulatedText.trim().split(/\s+/).length
        };
    }
} 