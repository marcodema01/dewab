import { EventEmitter } from 'https://cdn.skypack.dev/eventemitter3';
import { blobToJSON, base64ToArrayBuffer, Logger } from './gemini-utils.js';
import { getWebsocketUrl, getDefaultConfig } from './gemini-config.js';
import { eventBus, EVENT_TYPES } from '../event-bus.js';
import { WebSocketTransport } from './connection/websocket-transport.js';
import { MessageHandler } from './connection/message-handler.js';

/**
 * @file Handles Gemini-specific WebSocket communication.
 * This client uses WebSocketTransport for connection management and MessageHandler
 * for message processing, focusing on Gemini API protocol coordination.
 */

/**
 * GeminiWebsocketClient provides Gemini-specific WebSocket communication.
 * It coordinates between WebSocketTransport for connections and MessageHandler 
 * for message processing, while maintaining a clean API for Gemini protocol operations.
 * @extends EventEmitter
 */
export class GeminiWebsocketClient extends EventEmitter {
    /**
     * Creates a new GeminiWebsocketClient.
     * @param {string} [name='GeminiWebSocketClient'] - An identifier for this client instance, used in logging.
     */
    constructor(name = 'GeminiWebSocketClient') {
        super();
        this.name = name;
        this.config = getDefaultConfig();
        
        // Create the WebSocket transport
        this.transport = new WebSocketTransport(getWebsocketUrl(), `${name}-Transport`);
        
        // Create the message handler
        this.messageHandler = new MessageHandler(`${name}-MessageHandler`);
        
        this._setupTransportListeners();
        this._setupMessageHandlerListeners();
        
        Logger.debug(this.name, 'GeminiWebsocketClient initialized with transport and message handler');
    }

    /**
     * Sets up event listeners for the WebSocket transport
     * @private
     */
    _setupTransportListeners() {
        this.transport.on('open', () => {
            Logger.info(this.name, 'Transport connected - ready for Gemini communication');
            // Note: We don't emit 'open' here - we'll emit it after setup is complete
        });

        this.transport.on('close', (closeInfo) => {
            Logger.warn(this.name, 'Transport connection closed:', closeInfo);
            this.messageHandler.resetAccumulationState();
            this.emit('close', closeInfo);
        });

        this.transport.on('error', (errorInfo) => {
            Logger.error(this.name, 'Transport error:', errorInfo);
            this.emit('error', errorInfo);
        });

        this.transport.on('message', (message) => {
            this.messageHandler.processMessage(message);
        });
    }

    /**
     * Sets up event listeners for the MessageHandler
     * @private
     */
    _setupMessageHandlerListeners() {
        // Forward setup completion
        this.messageHandler.on('setup_complete', () => {
            this.emit('setup_complete');
        });

        // Forward tool calls
        this.messageHandler.on('tool_call', (toolCall) => {
            this.emit('tool_call', toolCall);
        });

        // Forward tool call cancellations
        this.messageHandler.on('tool_call_cancellation', (cancellation) => {
            this.emit('tool_call_cancellation', cancellation);
        });

        // Forward interruptions
        this.messageHandler.on('interrupted', () => {
            this.emit('interrupted');
        });

        // Handle turn completion and emit accumulated content
        this.messageHandler.on('turn_complete', (results) => {
            // Emit accumulated content via event bus for consistency with existing system
            if (results.text) {
                eventBus.emit(EVENT_TYPES.GEMINI_COMPLETE_TEXT_RESPONSE, results.text);
            }
            if (results.transcription) {
                eventBus.emit(EVENT_TYPES.GEMINI_RESPONSE_TRANSCRIPTION, results.transcription);
            }
            
            this.emit('turn_complete');
        });

        // Handle audio data
        this.messageHandler.on('audio', (audioInfo) => {
            // Convert base64 to ArrayBuffer for compatibility with existing system
            const audioData = base64ToArrayBuffer(audioInfo.data);
            this.emit('audio', audioData);
        });

        // Handle user transcriptions
        this.messageHandler.on('user_transcription', (transcriptionText) => {
            eventBus.emit(EVENT_TYPES.GEMINI_USER_TRANSCRIPTION, transcriptionText);
        });

        // Handle handler errors
        this.messageHandler.on('handler_error', (errorInfo) => {
            Logger.error(this.name, 'Message handler error:', errorInfo);
            this.emit('error', {
                type: 'message_handler',
                error: errorInfo.error,
                context: errorInfo.messageType
            });
        });

        // Log unhandled messages
        this.messageHandler.on('unhandled_message', (message) => {
            Logger.debug(this.name, 'Unhandled message type:', Object.keys(message));
        });
    }

    /**
     * Establishes connection to Gemini API and sends setup configuration.
     * @async
     * @param {object} [configOverrides={}] - Optional configuration overrides
     * @returns {Promise<void>} A promise that resolves when setup is complete
     */
    async connect(configOverrides = {}) {
        if (this.transport.isConnected()) {
            Logger.debug(this.name, 'Already connected to Gemini');
            return;
        }

        Logger.info(this.name, 'Connecting to Gemini API...');
        
        try {
            // Connect the transport
            await this.transport.connect();
            
            // Send Gemini setup configuration
            await this._sendSetupConfiguration(configOverrides);
            
            Logger.info(this.name, 'Connected to Gemini and setup complete');
            
        } catch (error) {
            Logger.error(this.name, 'Failed to connect to Gemini:', error);
            throw error;
        }
    }

    /**
     * Sends the initial setup configuration to Gemini
     * @private
     * @param {object} configOverrides - Configuration overrides
     */
    async _sendSetupConfiguration(configOverrides) {
        const baseConfig = this.config;
        const finalConfig = { ...baseConfig, ...configOverrides };
        
        // Ensure safetySettings are properly merged
        finalConfig.safetySettings = configOverrides.safetySettings || baseConfig.safetySettings;
        
        await this.transport.sendMessage({ setup: finalConfig });
        Logger.info(this.name, 'Setup configuration sent to Gemini');
        Logger.debug(this.name, 'Setup config details:', finalConfig);
    }

    /**
     * Disconnects from Gemini API
     */
    disconnect() {
        Logger.info(this.name, 'Disconnecting from Gemini');
        this.messageHandler.resetAccumulationState();
        this.transport.disconnect(true); // Manual disconnect
    }

    /**
     * Sends encoded audio chunk to the Gemini API.
     * @param {string} base64audio - The base64 encoded audio string.
     */
    async sendAudio(base64audio) {
        const data = { realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm', data: base64audio }] } };
        
        // Log a snippet for audio, but not the whole thing
        Logger.debug(this.name, 'Sending audio chunk:', { 
            mimeType: 'audio/pcm', 
            dataLength: base64audio.length,
            sampleBase64: base64audio.substring(0, 40) + '...'
        });
        
        await this.transport.sendMessage(data);
    }

    /**
     * Sends a base64 encoded image to the Gemini API.
     * @async
     * @param {string} base64image - The base64 encoded image data (JPEG format expected).
     * @returns {Promise<void>}
     */
    async sendImage(base64image) {
        const data = { realtimeInput: { mediaChunks: [{ mimeType: 'image/jpeg', data: base64image }] } };
        await this.transport.sendMessage(data);
        Logger.debug(this.name, 'Image sent to Gemini');
    }

    /**
     * Sends a text message to the Gemini API.
     * @async
     * @param {string} text - The text message to send.
     * @param {boolean} [endOfTurn=true] - If true, signals that this is the end of the user's turn.
     * @returns {Promise<void>}
     */
    async sendText(text, endOfTurn = true) {
        const formattedText = { 
            clientContent: { 
                turns: [{
                    role: 'user', 
                    parts: { text: text } 
                }], 
                turnComplete: endOfTurn 
            } 
        };
        
        Logger.info(this.name, `Sending text to Gemini:`, JSON.stringify(formattedText, null, 2));
        await this.transport.sendMessage(formattedText);
    }

    /**
     * Sends a response to a tool call requested by Gemini.
     * @async
     * @param {object} toolResponsePayload - The payload containing the tool response details.
     * @param {string} toolResponsePayload.id - The ID of the function call this response corresponds to.
     * @param {any} [toolResponsePayload.output] - The output of the tool execution. Required if no error.
     * @param {string} [toolResponsePayload.error] - An error message if the tool execution failed.
     * @returns {Promise<void>}
     */
    async sendToolResponse(toolResponsePayload) {
        if (!toolResponsePayload || !toolResponsePayload.id) {
            throw new Error('Tool response payload must include an id');
        }

        const { id, output, error } = toolResponsePayload;
        let functionResponse;

        if (error) {
            functionResponse = {
                id,
                response: { error: { message: error } }
            };
        } else if (output === undefined) {
            throw new Error('Tool response payload must include an output when no error is provided');
        } else {
            functionResponse = {
                id,
                response: { output: output }
            };
        }

        const toolResponse = { toolResponse: { functionResponses: [functionResponse] } };
        Logger.info(this.name, 'Sending tool response to Gemini:', JSON.stringify(toolResponse, null, 2));
        await this.transport.sendMessage(toolResponse);
    }

    /**
     * Sends an end-of-turn signal to Gemini without any content.
     * This is useful for signaling that audio input has finished.
     * @async
     * @returns {Promise<void>}
     */
    async sendEndOfTurn() {
        Logger.info(this.name, 'Sending end-of-turn signal to Gemini');
        await this.sendText('', true); // Empty text with turnComplete=true
    }

    /**
     * Gets the current connection state
     * @returns {boolean} True if connected to Gemini
     */
    get isConnected() {
        return this.transport.isConnected();
    }

    /**
     * Gets transport status for debugging
     * @returns {object} Transport status information
     */
    getTransportStatus() {
        return this.transport.getStatus();
    }

    /**
     * Gets message handler status for debugging
     * @returns {object} Message handler status information
     */
    getMessageHandlerStatus() {
        return this.messageHandler.getStatus();
    }

    /**
     * Registers a custom message handler
     * @param {string} messageType - Type of message to handle
     * @param {Function} handler - Handler function
     */
    registerMessageHandler(messageType, handler) {
        this.messageHandler.registerHandler(messageType, handler);
    }

    /**
     * Unregisters a custom message handler
     * @param {string} messageType - Type of message handler to remove
     */
    unregisterMessageHandler(messageType) {
        this.messageHandler.unregisterHandler(messageType);
    }
} 