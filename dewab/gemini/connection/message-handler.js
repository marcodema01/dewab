import { EventEmitter } from 'https://cdn.skypack.dev/eventemitter3';
import { Logger } from '../gemini-utils.js';
import { TextChatHandler } from '../features/text-chat-handler.js';
import { VoiceChatHandler } from '../features/voice-chat-handler.js';
import { ToolExecutionHandler } from '../features/tool-execution-handler.js';

/**
 * MessageHandler manages routing and processing of incoming messages.
 * It coordinates between feature-specific handlers and maintains backward compatibility.
 * 
 * Events emitted:
 * - 'setup_complete': Setup process completed
 * - 'tool_call': Tool call received from API
 * - 'tool_call_cancellation': Tool call cancelled
 * - 'interrupted': Interaction interrupted
 * - 'turn_complete': Turn completed
 * - 'audio': Audio data received
 * - 'content_accumulated': Text or transcription accumulated
 * - 'user_transcription': User speech transcription
 * - 'unhandled_message': Message type not handled
 */
export class MessageHandler extends EventEmitter {
    /**
     * Creates a new MessageHandler instance
     * @param {string} [name='MessageHandler'] - Name for logging purposes
     */
    constructor(name = 'MessageHandler') {
        super();
        
        this.name = name;
        this.messageHandlers = new Map();
        
        // Create feature-specific handlers
        this.textChatHandler = new TextChatHandler(`${name}-TextChat`);
        this.voiceChatHandler = new VoiceChatHandler(`${name}-VoiceChat`);
        this.toolExecutionHandler = new ToolExecutionHandler(`${name}-ToolExecution`);
        
        // Set up feature handler event forwarding
        this._setupFeatureHandlerListeners();
        
        // Register default Gemini message handlers
        this._registerDefaultHandlers();
        
        Logger.debug(this.name, 'MessageHandler initialized with feature handlers');
    }

    /**
     * Sets up event listeners for feature handlers to maintain backward compatibility
     * @private
     */
    _setupFeatureHandlerListeners() {
        // Text chat handler events
        this.textChatHandler.on('text_accumulated', (data) => {
            this.emit('content_accumulated', {
                type: 'text',
                chunk: data.chunk,
                accumulated: data.accumulated
            });
        });

        this.textChatHandler.on('text_complete', (text) => {
            // This will be handled in turn completion
        });

        // Voice chat handler events
        this.voiceChatHandler.on('audio_received', (audioData) => {
            this.emit('audio', audioData);
        });

        this.voiceChatHandler.on('user_transcription', (transcriptionData) => {
            this.emit('user_transcription', transcriptionData.text);
        });

        this.voiceChatHandler.on('transcription_accumulated', (data) => {
            this.emit('content_accumulated', {
                type: 'transcription',
                chunk: data.chunk,
                accumulated: data.accumulated
            });
        });

        // Tool execution handler events
        this.toolExecutionHandler.on('tool_call_received', (data) => {
            this.emit('tool_call', data.toolCall);
        });

        this.toolExecutionHandler.on('tool_cancellation_received', (data) => {
            this.emit('tool_call_cancellation', data.cancellation);
        });

        this.toolExecutionHandler.on('tool_error', (data) => {
            Logger.error(this.name, 'Tool execution error:', data);
        });
    }

    /**
     * Registers default handlers for Gemini API messages
     * @private
     */
    _registerDefaultHandlers() {
        // Setup completion handler
        this.registerHandler('setupComplete', (message) => {
            Logger.info(this.name, 'Setup completed');
            this.emit('setup_complete', message);
        });

        // Tool call handler - delegate to ToolExecutionHandler
        this.registerHandler('toolCall', (message) => {
            this.toolExecutionHandler.processToolCall(message.toolCall);
        });

        // Tool call cancellation handler - delegate to ToolExecutionHandler
        this.registerHandler('toolCallCancellation', (message) => {
            this.toolExecutionHandler.processToolCancellation(message.toolCallCancellation);
        });

        // Server content handler - coordinate between feature handlers
        this.registerHandler('serverContent', (message) => {
            this._processServerContent(message.serverContent);
        });
    }

    /**
     * Registers a handler for a specific message type
     * @param {string} messageType - Type of message to handle
     * @param {Function} handler - Handler function that receives the message
     */
    registerHandler(messageType, handler) {
        if (typeof handler !== 'function') {
            throw new Error(`Handler for ${messageType} must be a function`);
        }
        
        this.messageHandlers.set(messageType, handler);
        Logger.debug(this.name, `Registered handler for message type: ${messageType}`);
    }

    /**
     * Removes a handler for a specific message type
     * @param {string} messageType - Type of message handler to remove
     */
    unregisterHandler(messageType) {
        if (this.messageHandlers.has(messageType)) {
            this.messageHandlers.delete(messageType);
            Logger.debug(this.name, `Unregistered handler for message type: ${messageType}`);
        }
    }

    /**
     * Processes an incoming message by routing it to appropriate handlers
     * @param {object} message - The message to process
     */
    processMessage(message) {
        if (!message || typeof message !== 'object') {
            Logger.warn(this.name, 'Invalid message received:', message);
            return;
        }

        Logger.debug(this.name, 'Processing message:', JSON.stringify(message, null, 2));

        // Find and execute handler for each message property
        let handled = false;
        for (const [messageType, handler] of this.messageHandlers) {
            if (message.hasOwnProperty(messageType)) {
                try {
                    handler(message);
                    handled = true;
                } catch (error) {
                    Logger.error(this.name, `Error in handler for ${messageType}:`, error);
                    this.emit('handler_error', { messageType, error, message });
                }
            }
        }

        // Emit unhandled message event if no handlers processed it
        if (!handled) {
            Logger.debug(this.name, 'No handler found for message:', Object.keys(message));
            this.emit('unhandled_message', message);
        }
    }

    /**
     * Processes server content using feature handlers
     * @private
     * @param {object} serverContent - Server content object
     */
    _processServerContent(serverContent) {
        // Handle input transcription (user speech) - delegate to VoiceChatHandler
        if (serverContent.inputTranscription) {
            this.voiceChatHandler.processUserTranscription(serverContent.inputTranscription.text);
            return;
        }

        // Handle output transcription (Gemini speech) - delegate to VoiceChatHandler
        if (serverContent.outputTranscription) {
            this.voiceChatHandler.processGeminiTranscription(serverContent.outputTranscription.text);
            return;
        }

        // Handle interruptions
        if (serverContent.interrupted) {
            Logger.info(this.name, 'Interaction interrupted');
            this._handleInterruption();
            return;
        }

        // Handle turn completion
        if (serverContent.turnComplete) {
            Logger.info(this.name, 'Turn completed');
            this._handleTurnComplete();
            return;
        }

        // Process model turn content
        if (serverContent.modelTurn) {
            this._processModelTurn(serverContent.modelTurn);
        }
    }

    /**
     * Handles interruptions by resetting all feature handlers
     * @private
     */
    _handleInterruption() {
        this.textChatHandler.reset();
        this.voiceChatHandler.reset();
        // Don't reset tool handler as tool calls might be in progress
        
        this.emit('interrupted');
    }

    /**
     * Handles turn completion - aggregates results from all feature handlers
     * @private
     */
    _handleTurnComplete() {
        const results = {};
        
        // Get text results from TextChatHandler
        const textResult = this.textChatHandler.completeTurn();
        if (textResult) {
            results.text = textResult;
        }
        
        // Get voice results from VoiceChatHandler
        const voiceResult = this.voiceChatHandler.completeTurn();
        if (voiceResult && voiceResult.transcription) {
            results.transcription = voiceResult.transcription;
        }
        
        this.emit('turn_complete', results);
    }

    /**
     * Processes model turn content using feature handlers
     * @private
     * @param {object} modelTurn - Model turn object with parts
     */
    _processModelTurn(modelTurn) {
        const parts = modelTurn.parts || [];
        
        Logger.debug(this.name, 'Processing model turn parts:', parts.map(p => ({
            hasText: !!p.text,
            text: p.text?.substring(0, 50),
            hasAudio: !!(p.inlineData && p.inlineData.mimeType?.startsWith('audio/pcm'))
        })));
        
        // Split parts by type
        const audioParts = parts.filter(p => p.inlineData && p.inlineData.mimeType?.startsWith('audio/pcm'));
        const textParts = parts.filter(p => p.text && p.text.trim());

        // Delegate to appropriate feature handlers
        if (audioParts.length > 0) {
            this.voiceChatHandler.processAudioParts(audioParts);
        }

        if (textParts.length > 0) {
            this.textChatHandler.processTextParts(textParts);
        }
    }

    /**
     * Resets accumulation state in all feature handlers
     */
    resetAccumulationState() {
        this.textChatHandler.reset();
        this.voiceChatHandler.reset();
        this.toolExecutionHandler.reset();
        Logger.debug(this.name, 'All feature handler states reset');
    }

    /**
     * Gets the current accumulation state from all feature handlers
     * @returns {object} Current accumulated content
     */
    getAccumulationState() {
        const textState = this.textChatHandler.getState();
        const voiceState = this.voiceChatHandler.getState();
        
        return {
            text: textState.accumulatedText,
            transcription: voiceState.accumulatedTranscription,
            // Legacy compatibility
            textLength: textState.textLength,
            transcriptionLength: voiceState.transcriptionLength,
            isProcessing: textState.isActive || voiceState.isTranscribing
        };
    }

    /**
     * Gets information about registered handlers
     * @returns {Array<string>} List of registered message types
     */
    getRegisteredHandlers() {
        return Array.from(this.messageHandlers.keys());
    }

    /**
     * Gets handler status for debugging
     * @returns {object} Handler status information
     */
    getStatus() {
        return {
            name: this.name,
            registeredHandlers: this.getRegisteredHandlers(),
            accumulationState: this.getAccumulationState(),
            featureHandlers: {
                textChat: this.textChatHandler.getStats(),
                voiceChat: this.voiceChatHandler.getStats(),
                toolExecution: this.toolExecutionHandler.getStats()
            }
        };
    }

    /**
     * Gets detailed feature handler information
     * @returns {object} Detailed feature handler status
     */
    getFeatureHandlerStatus() {
        return {
            textChat: {
                state: this.textChatHandler.getState(),
                stats: this.textChatHandler.getStats(),
                isProcessing: this.textChatHandler.isProcessing()
            },
            voiceChat: {
                state: this.voiceChatHandler.getState(),
                stats: this.voiceChatHandler.getStats(),
                isProcessing: this.voiceChatHandler.isProcessing()
            },
            toolExecution: {
                state: this.toolExecutionHandler.getState(),
                stats: this.toolExecutionHandler.getStats(),
                isProcessing: this.toolExecutionHandler.isProcessing()
            }
        };
    }

    /**
     * Provides access to feature handlers for advanced usage
     * @returns {object} Feature handler instances
     */
    getFeatureHandlers() {
        return {
            textChat: this.textChatHandler,
            voiceChat: this.voiceChatHandler,
            toolExecution: this.toolExecutionHandler
        };
    }
} 