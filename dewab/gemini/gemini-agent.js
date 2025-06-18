import { GeminiWebsocketClient } from './gemini-websocket-client.js';
import { EventEmitter } from 'https://cdn.skypack.dev/eventemitter3';
import { AudioManager } from './audio/audio-manager.js';
import { Logger } from './gemini-utils.js';
import { eventBus, EVENT_TYPES } from '../event-bus.js';
// ToolManager is now injected as UnifiedToolManager from the main Dewab class

/**
 * @file Manages interaction with the Gemini API for voice-based chat.
 * It handles WebSocket connection, initialization, sending text, and processing responses (text & audio).
 * It emits events that a UI layer can subscribe to for updating the display.
 */

/**
 * GeminiAgent orchestrates communication with the Gemini API via WebSockets,
 * handling text and audio data streams, and emitting events for UI updates.
 * @extends EventEmitter
 */
export class GeminiAgent extends EventEmitter {
    /**
     * Creates an instance of GeminiAgent.
     * @param {ToolManager} [toolManager=null] - Optional ToolManager instance for handling function calls.
     */
    constructor(toolManager = null) {
        super();
        this.websocketClient = new GeminiWebsocketClient('GeminiAgent');
        this.connected = false;
        this.initialized = false;
        
        // Audio management
        this.audioManager = new AudioManager();
        
        // Turn management
        this.currentStreamingMessage = null;
        this.lastUserMessageType = null; // 'text' or 'audio'
        
        this.toolManager = toolManager;

        this._setupWebSocketListeners();
        this._setupAudioManagerListeners();

        Logger.info('GeminiAgent', 'GeminiWebsocketClient initialized with transport and message handler');
    }

    /**
     * Sets up listeners for events from the AudioManager.
     * @private
     */
    _setupAudioManagerListeners() {
        // Forward audio manager events to UI layer via event bus
        this.audioManager.on('status_update', (status) => {
            eventBus.emit(EVENT_TYPES.GEMINI_STATUS_UPDATE, status);
            if (status.microphoneActive !== undefined) {
                eventBus.emit(status.microphoneActive ? 
                    EVENT_TYPES.AUDIO_MIC_ACTIVATED : 
                    EVENT_TYPES.AUDIO_MIC_DEACTIVATED, status);
            }
        });

        this.audioManager.on('error', (error) => {
            eventBus.emit(EVENT_TYPES.AUDIO_ERROR, error);
        });

        this.audioManager.on('recording_stopped', () => {
            // New event bus system
            eventBus.emit(EVENT_TYPES.AUDIO_RECORDING_STOPPED);
            
            // Send end of turn signal when recording is stopped
            if (this.connected) {
                this.websocketClient.sendEndOfTurn()
                    .then(() => {
                        Logger.info('GeminiAgent', 'End of turn sent because recording stopped.');
                        eventBus.emit(EVENT_TYPES.GEMINI_SYSTEM_MESSAGE, 'Audio turn ended (recording stopped).');
                    })
                    .catch((error) => {
                        Logger.error('GeminiAgent', 'Failed to send end of turn on stopRecording:', error);
                    });
            }
        });
    }

    /**
     * Sets up listeners for events from the underlying GeminiWebsocketClient.
     * @private
     */
    _setupWebSocketListeners() {
        // Handle incoming audio data from the model
        this.websocketClient.on('audio', async (data) => {
            try {
                await this.audioManager.streamAudio(new Uint8Array(data));
                eventBus.emit(EVENT_TYPES.GEMINI_AUDIO_CHUNK, data);
            } catch (error) {
                // Use centralized error handling
                Logger.handleRecoverableError(error, {
                    component: 'GeminiAgent',
                    operation: 'audio_processing'
                });
            }
        });

        // Handle model interruptions by stopping audio playback
        this.websocketClient.on('interrupted', () => {
            this.currentStreamingMessage = null;
            this.audioManager.stopPlayback();
            eventBus.emit(EVENT_TYPES.GEMINI_TEXT_END);
            eventBus.emit(EVENT_TYPES.GEMINI_SYSTEM_MESSAGE, "Model interaction interrupted");
        });

        // Handle turn completion
        this.websocketClient.on('turn_complete', () => {
            this.currentStreamingMessage = null;
            eventBus.emit(EVENT_TYPES.GEMINI_TEXT_END);
            eventBus.emit(EVENT_TYPES.GEMINI_SYSTEM_MESSAGE, "Model turn complete");
            this.audioManager.markStreamComplete();
        });

        // Note: Removed old 'content' event handler - text accumulation now handled in WebSocket client
        // Complete text messages are emitted via GEMINI_COMPLETE_TEXT_RESPONSE and GEMINI_RESPONSE_TRANSCRIPTION events

        // Handle tool calls
        this.websocketClient.on('tool_call', async (toolCall) => {
            await this.handleToolCall(toolCall);
        });
        
        // Handle websocket errors
        this.websocketClient.on('error', (errorData) => {
            // Use centralized error handling for WebSocket errors
            Logger.handleCriticalError(errorData, {
                component: 'GeminiAgent',
                operation: 'websocket_internal',
                context: errorData.context || 'websocket_internal',
                throwAfter: false  // Don't throw in event handlers
            });
        });

        this.websocketClient.on('open', () => {
            Logger.info('GeminiAgent', 'WebSocket client connection opened/reconnected.');
            this.connected = true;
            this.initialized = true; // Assume initialization persists across reconnections

            eventBus.emit(EVENT_TYPES.GEMINI_STATUS_UPDATE, {
                connected: true,
                initialized: true,
                message: 'Gemini Agent connected and ready.'
            });
        });

        // Handle websocket close
        this.websocketClient.on('close', (closeData) => {
            Logger.warn('GeminiAgent', 'WebSocket client connection closed:', closeData);
            
            // Stop recording to prevent errors
            if (this.audioManager.isMicrophoneActive) {
                try {
                    this.audioManager.stopRecording();
                    Logger.info('GeminiAgent', 'Stopped recording due to WebSocket closure');
                } catch (error) {
                    Logger.error('GeminiAgent', 'Error stopping recorder on close:', error);
                }
            }
            
            this.connected = false;
            this.initialized = false;
            this.currentStreamingMessage = null;
            
            eventBus.emit(EVENT_TYPES.GEMINI_STATUS_UPDATE, { 
                connected: false, 
                initialized: false, 
                message: 'Gemini Agent disconnected due to WebSocket closure.'
            });
        });
    }

    /**
     * Handle tool calls from Gemini
     */
    async handleToolCall(toolCall) {
        const systemMessage = `Received tool call: ${toolCall.functionCalls?.[0]?.name || 'Unknown tool'}`;
        eventBus.emit(EVENT_TYPES.GEMINI_SYSTEM_MESSAGE, systemMessage);
        eventBus.emit(EVENT_TYPES.GEMINI_TOOL_CALL, toolCall);
        
        if (this.toolManager && toolCall.functionCalls && toolCall.functionCalls.length > 0) {
            const functionCallDetails = toolCall.functionCalls[0];
            try {
                const toolResponse = await this.toolManager.handleToolCall({
                    name: functionCallDetails.name,
                    args: functionCallDetails.args,
                    id: functionCallDetails.id
                });
                
                await this.websocketClient.sendToolResponse(toolResponse);
                const responseMessage = `Tool response for "${functionCallDetails.name}" sent.`;
                eventBus.emit(EVENT_TYPES.GEMINI_SYSTEM_MESSAGE, responseMessage);
            } catch (error) {
                Logger.error('GeminiAgent', `Error handling tool call "${functionCallDetails.name}":`, error);
                try {
                    await this.websocketClient.sendToolResponse({
                        id: functionCallDetails.id,
                        error: `Failed to execute tool ${functionCallDetails.name}: ${error.message}`
                    });
                } catch (sendError) {
                    Logger.error('GeminiAgent', 'Failed to send tool error response:', sendError);
                }
                const errorPayload = {
                    context: 'tool_call_execution',
                    message: `Error processing tool call ${functionCallDetails.name}: ${error.message}`,
                    errorObj: error
                };
                eventBus.emit(EVENT_TYPES.GEMINI_ERROR, errorPayload);
            }
        }
    }

    /**
     * Connects to the Gemini WebSocket server and initializes resources
     */
    async connect(configOverrides = {}) {
        if (this.connected) {
            Logger.warn('GeminiAgent', 'Already connected to Gemini');
            return;
        }

        Logger.info('GeminiAgent', 'Connecting to Gemini API...');

        try {
            // Configure tools if available
            if (this.toolManager) {
                const toolDeclarations = this.toolManager.getToolDeclarations();
                if (toolDeclarations && toolDeclarations.length > 0) {
                    configOverrides.tools = { functionDeclarations: toolDeclarations };
                    Logger.info('GeminiAgent', `Including ${toolDeclarations.length} tool declarations`);
                } else {
                    configOverrides.tools = { functionDeclarations: [] };
                }
            } else {
                configOverrides.tools = { functionDeclarations: [] };
            }

            await this.websocketClient.connect(configOverrides);
            this.connected = true;
            Logger.info('GeminiAgent', 'WebSocket connected successfully');

            await this.initialize();
            
            const statusUpdate = { 
                connected: true, 
                initialized: this.initialized, 
                message: 'Gemini Agent connected and initialized' 
            };
            eventBus.emit(EVENT_TYPES.GEMINI_STATUS_UPDATE, statusUpdate);
            
            // No automatic initial trigger - let user start the conversation when ready
            
        } catch (error) {
            Logger.error('GeminiAgent', 'Failed to connect to Gemini:', error);
            Logger.error('GeminiAgent', 'Error details:', {
                message: error.message,
                stack: error.stack,
                type: error.type || 'unknown'
            });
            this.connected = false;
            this.initialized = false;
            
            eventBus.emit(EVENT_TYPES.GEMINI_ERROR, {
                type: 'connection',
                message: `Failed to connect to Gemini: ${error.message}`,
                error
            });
            throw error;
        }
    }

    /**
     * Initializes audio system
     */
    async initialize() {
        if (this.initialized) return;

        // Logger.info('GeminiAgent', 'Initializing audio system...'); // Removed redundant log, AudioManager handles this

        try {
            await this.audioManager.initialize();
            this.initialized = true;
            Logger.info('GeminiAgent', 'Audio system initialized successfully');
            
        } catch (error) {
            Logger.error('GeminiAgent', 'Error initializing audio system:', error);
            // Continue without audio if it fails
            this.initialized = true; // Still mark as initialized for text-only functionality
        }
    }

    /**
     * Sends a text message to Gemini
     */
    async sendText(text) {
        if (!this.connected) {
            throw new Error('Not connected to Gemini');
        }
        
        try {
            // Reset streaming state for new turn
            this.currentStreamingMessage = null;
            await this.websocketClient.sendText(text);
        } catch (error) {
            // Use centralized error handling
            Logger.handleError(error, {
                component: 'GeminiAgent',
                operation: 'sendText',
                throwAfter: true
            });
        }
    }

    /**
     * Sends audio data to Gemini
     */
    async sendAudio(audioData) {
        if (!this.connected) {
            // Silently return if not connected to avoid error spam
            return;
        }
        
        try {
            await this.websocketClient.sendAudio(audioData);
            
            // Debug: Log when audio is sent (sample every 100th chunk to avoid spam)
            if (Math.random() < 0.01) {
                Logger.debug('GeminiAgent', 'Audio chunk sent');
            }
            
        } catch (error) {
            // Use centralized error handling for audio sending (recoverable)
            Logger.handleRecoverableError(error, {
                component: 'GeminiAgent',
                operation: 'sendAudio'
            });
            // Don't throw to avoid breaking the audio pipeline
        }
    }

    /**
     * Starts audio recording
     */
    async startRecording() {
        if (!this.connected || !this.initialized) {
            throw new Error('Not connected or initialized');
        }

        try {
            await this.audioManager.startRecording((audioData) => {
                this.sendAudio(audioData);
            });
        } catch (error) {
            // Use centralized error handling for recording start
            Logger.handleError(error, {
                component: 'GeminiAgent',
                operation: 'startRecording',
                throwAfter: true
            });
        }
    }

    /**
     * Stops audio recording
     */
    async stopRecording() {
        try {
            await this.audioManager.stopRecording();
            // Note: End of turn signal is now handled by AudioManager event listener
        } catch (error) {
            Logger.error('GeminiAgent', 'Failed to stop recording:', error);
            const errorPayload = { context: 'stopRecording', message: error.message, errorObj: error };
            eventBus.emit(EVENT_TYPES.GEMINI_ERROR, errorPayload);
            throw error;
        }
    }

    /**
     * Toggles microphone recording on/off
     */
    async toggleMicrophone() {
        if (!this.connected) {
            const errorPayload = { context: 'microphone_toggle', message: 'Cannot toggle microphone: Not connected' };
            eventBus.emit(EVENT_TYPES.GEMINI_ERROR, errorPayload);
            return;
        }
        
        if (!this.initialized) {
            Logger.info('GeminiAgent', "Audio system not initialized. Attempting to initialize...");
            await this.initialize();
            if (!this.initialized) {
                const errorPayload = { context: 'microphone_toggle', message: 'Audio system failed to initialize' };
                eventBus.emit(EVENT_TYPES.GEMINI_ERROR, errorPayload);
                return;
            }
        }

        try {
            await this.audioManager.toggleMicrophone((audioData) => {
                this.sendAudio(audioData);
            });
        } catch (error) {
            Logger.error('GeminiAgent', 'Error toggling microphone:', error);
            const errorPayload = { context: 'microphone_toggle', message: error.message, errorObj: error };
            eventBus.emit(EVENT_TYPES.GEMINI_ERROR, errorPayload);
        }
    }

    /**
     * Disconnects from Gemini and cleans up resources
     */
    async disconnect() {
        Logger.info('GeminiAgent', "Disconnecting...");
        
        // Clean up audio resources
        try {
            await this.audioManager.cleanup();
        } catch (error) {
            Logger.error('GeminiAgent', "Error cleaning up audio manager:", error);
        }

        // Disconnect WebSocket
        this.websocketClient.disconnect();

        this.connected = false;
        this.initialized = false;
        this.currentStreamingMessage = null;

        const statusUpdate = { 
            connected: false, 
            initialized: false, 
            message: 'Disconnected from Gemini' 
        };
        eventBus.emit(EVENT_TYPES.GEMINI_STATUS_UPDATE, statusUpdate);
        eventBus.emit(EVENT_TYPES.GEMINI_DISCONNECTED, { message: 'Disconnected from Gemini' });
    }

    /**
     * Gets the current microphone state
     */
    get isMicrophoneActive() {
        return this.audioManager.isMicrophoneActive;
    }

    /**
     * Gets connection status
     */
    get isConnected() {
        return this.connected;
    }

    /**
     * Gets initialization status
     */
    get isInitialized() {
        return this.initialized;
    }

    /**
     * Resumes the audio context if suspended.
     * @returns {Promise<void>}
     */
    async resumeAudio() {
        if (this.audioManager) {
            await this.audioManager.resumeAudioContext();
        }
    }
} 