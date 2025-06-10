/**
 * Unified Dewab API - Main entry point for the Dewab library
 * Provides a fluent interface for device control, chat, and tool management
 */

import { SupabaseDeviceClient } from './core/supabase-device-client.js';
import { ChatInterface } from './core/chat-interface.js';
import { GeminiAgent } from './gemini/gemini-agent.js';
import { ToolRegistry } from './core/tool-registry.js';
import { UnifiedToolManager } from './core/unified-tool-manager.js';
import { eventBus, EVENT_TYPES } from './event-bus.js';
import { Logger } from './gemini/gemini-utils.js';
import { DeviceProxy } from './core/device-proxy.js';
import { configManager } from './config-manager.js';

/**
 * Main Dewab class - provides unified interface for all Dewab functionality
 */
class Dewab {
    /**
     * Creates and connects a new Dewab instance in one step.
     * This is the recommended way to initialize Dewab for most use cases.
     * @param {object} config - Configuration object (same as constructor).
     * @returns {Promise<Dewab>} Connected Dewab instance.
     * @throws {Error} If connection fails.
     */
    static async create(config = {}) {
        const dewab = new Dewab(config);
        await dewab.connect();
        return dewab;
    }

    /**
     * Initializes the Dewab system.
     * @param {object} config - Configuration object.
     * @param {string} [config.supabaseUrl] - Your Supabase project URL.
     * @param {string} [config.supabaseAnonKey] - Your Supabase anonymous key.
     * @param {string} [config.geminiApiKey] - Your Gemini API key.
     * @param {object} [config.geminiModelConfig] - Overrides for default Gemini model configuration.
     * @param {HTMLElement} [config.chatLogElement] - The HTML element for displaying chat messages.
     * @param {HTMLInputElement} [config.chatInputElement] - The HTML input element for chat.
     * @param {HTMLButtonElement} [config.sendChatButtonElement] - The HTML button for sending chat.
     * @param {HTMLButtonElement} [config.voiceButtonElement] - The HTML button for toggling voice input.
     * @param {string} [config.defaultDeviceName] - Default device name for operations.
     * @param {Array} [config.tools] - Array of tools to register upon initialization.
     */
    constructor(config = {}) {
        this._config = {
            gemini: {
                model: 'gemini-2.0-flash-exp',
                temperature: 1.8,
                topP: 0.95,
                topK: 65
            },
            defaultDeviceName: 'arduino',
            tools: [],
            ...config
        };
        
        const apiConfig = {};
        if (this._config.geminiApiKey) {
            apiConfig.geminiApiKey = this._config.geminiApiKey;
        }
        if (this._config.supabaseUrl) {
            apiConfig.supabaseUrl = this._config.supabaseUrl;
        }
        if (this._config.supabaseAnonKey) {
            apiConfig.supabaseAnonKey = this._config.supabaseAnonKey;
        }

        if (Object.keys(apiConfig).length > 0) {
            configManager.setConfig(apiConfig);
        }

        this._deviceClients = new Map();
        this._toolRegistry = new ToolRegistry();
        
        // Register tools from config right away
        if (this._config.tools && Array.isArray(this._config.tools)) {
            this._config.tools.forEach(tool => {
                if (tool.type === 'function') {
                    this.registerFunction(tool.name, tool.definition);
                } else if (tool.type === 'deviceCommand') {
                    this.registerDeviceCommand(tool.name, tool.definition);
                }
            });
        }

        this._geminiAgent = null;
        this._toolManager = null;
        this._chatInterface = null;
        this._connected = false;
        this._geminiReady = false;
        this._audioResumed = false;
        this._uiInitialized = false;
        
        this.eventBus = eventBus;

        Logger.info('Dewab', 'Dewab unified API initialized');
    }

    // --- Core Lifecycle & Status ---

    /**
     * Connects to all necessary services (Supabase Realtime, Gemini).
     * Initializes audio resources if applicable.
     * @returns {Promise<void>} Resolves when connections are established and system is ready.
     */
    async connect() {
        if (this._connected) {
            Logger.warn('Dewab', 'Already connected');
            return;
        }

        try {
            Logger.info('Dewab', 'Connecting to services...');
            
            // Initialize chat interface if elements are available or provided
            if (!this._chatInterface) {
                this._initializeChatInterface();
            }
            
            // Wire up UI event listeners automatically
            if (!this._uiInitialized) {
                this._setupUIEventListeners();
                this._uiInitialized = true;
            }

            // Set up event bridging
            this._setupEventBridge();
            
            // Initialize Gemini if configured
            await this._initializeGemini();
            
            this._connected = true;
            
            eventBus.emit(EVENT_TYPES.GEMINI_STATUS_UPDATE, {
                message: 'Dewab system connected and ready'
            });
            
            Logger.info('Dewab', 'All services connected successfully');
            
        } catch (error) {
            Logger.error('Dewab', 'Failed to connect:', error);
            eventBus.emit(EVENT_TYPES.GEMINI_ERROR, {
                context: 'connection',
                message: error.message,
                errorObj: error
            });
            throw error;
        }
    }

    /**
     * Disconnects from all services and cleans up resources.
     * @returns {Promise<void>}
     */
    async disconnect() {
        if (!this._connected) {
            Logger.warn('Dewab', 'Already disconnected.');
            return;
        }

        try {
            Logger.info('Dewab', 'Disconnecting from services...');
            
            if (this._geminiAgent) {
                await this._geminiAgent.disconnect();
                this._geminiAgent = null;
                this._geminiReady = false;
            }
            
            // Disconnect all device clients
            for (const client of this._deviceClients.values()) {
                if (client.disconnect) {
                    await client.disconnect();
                }
            }
            
            // Clear device clients
            this._deviceClients.clear();
            
            this._connected = false;
            
            eventBus.emit(EVENT_TYPES.GEMINI_STATUS_UPDATE, {
                message: 'Dewab system disconnected',
                connected: false,
                initialized: false
            });
            
            Logger.info('Dewab', 'Disconnected successfully');
            
        } catch (error) {
            Logger.error('Dewab', 'Error during disconnect:', error);
            throw error;
        }
    }

    /**
     * Checks if the Dewab system is fully connected and ready.
     * @returns {boolean} True if connected to essential services.
     */
    isConnected() {
        return this._connected;
    }

    /**
     * Checks if the Gemini agent is initialized and ready for interaction.
     * @returns {boolean}
     */
    isGeminiReady() {
        return this._geminiReady && this._geminiAgent?.isConnected;
    }

    /**
     * Checks if the microphone is currently active (recording).
     * @returns {boolean}
     */
    isMicrophoneActive() {
        return this._geminiAgent?.isMicrophoneActive || false;
    }

    /**
     * Gets a comprehensive status object for the Dewab system.
     * @returns {object}
     */
    getStatus() {
        return {
            connected: this._connected,
            geminiReady: this._geminiReady,
            microphoneActive: this.isMicrophoneActive(),
            registeredTools: this.getRegisteredTools(),
            deviceClients: Array.from(this._deviceClients.keys()),
            config: {
                defaultDeviceName: this._config.defaultDeviceName,
                geminiModel: this._config.gemini?.model
            }
        };
    }

    // --- Tool Management (for Gemini) ---

    /**
     * Registers a command that Gemini can use to control a device.
     * @param {string} name - The name of the command.
     * @param {object} definition - Command definition.
     */
    registerDeviceCommand(name, definition) {
        // Set default handler if not provided
        if (!definition.handler) {
            definition.handler = async (deviceName, params) => {
                return await this.device(deviceName).sendCommand(name, params);
            };
        }
        
        this._toolRegistry.registerCommand({
            name,
            targetType: 'device',
            ...definition
        });
        
        Logger.info('Dewab', `Registered device command: ${name}`);
    }

    /**
     * Registers a custom function that Gemini can call.
     * @param {string} name - The name of the function.
     * @param {object} definition - Function definition with handler.
     */
    registerFunction(name, definition) {
        if (!definition.handler) {
            throw new Error('Custom functions must have a handler');
        }
        
        this._toolRegistry.registerFunction({
            name,
            targetType: 'function',
            ...definition
        });
        
        Logger.info('Dewab', `Registered custom function: ${name}`);
    }

    /**
     * Gets the list of tool declarations in the format expected by Gemini.
     * @returns {Array<object>}
     */
    getToolDeclarations() {
        return this._toolRegistry.getGeminiToolDeclarations();
    }

    /**
     * Get information about registered tools.
     * @returns {Object} Tool registry information
     */
    getRegisteredTools() {
        return this._toolRegistry.getRegisteredTools();
    }

    // --- Device Interaction ---

    /**
     * Gets a proxy object for interacting with a specific device.
     * @param {string} deviceName - The unique name of the target device.
     * @returns {DeviceProxy} Device proxy instance.
     */
    device(deviceName) {
        return new DeviceProxy(this, deviceName);
    }

    // --- Chat UI Interaction ---

    /**
     * Accessor for the chat interface manager.
     * @returns {ChatInterface} Chat interface instance
     */
    get chat() {
        if (!this._chatInterface) {
            this._initializeChatInterface();
        }
        return this._chatInterface;
    }

    // --- Gemini Interaction ---

    /**
     * Sends a text message from the user to the Gemini model.
     * This will also typically display the user's message in the chat UI.
     * @param {string} text - The text message to send.
     * @returns {Promise<void>}
     */
    async sendTextMessageToGemini(text) {
        if (!this.isGeminiReady()) {
            throw new Error('Gemini is not ready. Please connect first.');
        }

        if (!text?.trim()) {
            if (this._chatInterface) {
                this._chatInterface.displaySystemNotification('Cannot send empty message.');
            }
            return;
        }

        try {
            // Display user message in chat
            if (this._chatInterface) {
                this._chatInterface.displayUserTypedMessage(text);
                this._chatInterface.clearChatInput();
            }
            
            // Send to Gemini
            await this._geminiAgent.sendText(text);
            
            Logger.debug('Dewab', `Message sent to Gemini: "${text}"`);
            
        } catch (error) {
            const errorMsg = `Error sending message: ${error.message}`;
            if (this._chatInterface) {
                this._chatInterface.displaySystemNotification(errorMsg);
            }
            Logger.error('Dewab', 'Error sending text message:', error);
            throw error;
        }
    }

    /**
     * Toggles the microphone for voice input to Gemini.
     * @returns {Promise<void>}
     */
    async toggleMicrophone() {
        if (!this.isGeminiReady()) {
            throw new Error('Gemini is not ready. Please connect first.');
        }

        try {
            await this._geminiAgent.toggleMicrophone();
            Logger.debug('Dewab', 'Microphone toggled successfully');
        } catch (error) {
            const errorMsg = `Error toggling microphone: ${error.message}`;
            if (this._chatInterface) {
                this._chatInterface.displaySystemNotification(errorMsg);
            }
            Logger.error('Dewab', 'Error toggling microphone:', error);
            throw error;
        }
    }

    /**
     * Resumes the audio context after a user gesture.
     * @returns {Promise<void>}
     */
    async resumeAudio() {
        if (!this._geminiAgent) {
            Logger.warn('Dewab', 'Gemini agent not initialized yet, cannot resume audio');
            return;
        }
        
        if (typeof this._geminiAgent.resumeAudio !== 'function') {
            Logger.error('Dewab', 'Gemini agent does not have resumeAudio method');
            return;
        }
        
        if (!this._audioResumed) {
            try {
                await this._geminiAgent.resumeAudio();
                this._audioResumed = true;
                Logger.info('Dewab', 'Audio context resumed successfully');
            } catch (error) {
                Logger.error('Dewab', 'Failed to resume audio context:', error);
            }
        }
    }

    /**
     * Wires up the UI event listeners for chat controls.
     * @private
     */
    _setupUIEventListeners() {
        const { sendChatButtonElement, chatInputElement, voiceButtonElement } = this._config;

        if (sendChatButtonElement && chatInputElement) {
            const sendTextMessage = async () => {
                await this.resumeAudio();
                if (!this.isGeminiReady()) {
                    this.chat.displaySystemNotification('Still waiting for Gemini to be ready...');
                    return;
                }
                const message = chatInputElement.value;
                if (message.trim() !== '') {
                    // This method already displays the user message and clears the input
                    await this.sendTextMessageToGemini(message);
                }
            };
            
            sendChatButtonElement.addEventListener('click', sendTextMessage);

            chatInputElement.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault(); // Prevent form submission if it's in a form
                    sendChatButtonElement.click();
                }
            });
        }

        if (voiceButtonElement) {
            voiceButtonElement.addEventListener('click', async () => {
                await this.resumeAudio();
                if (this.isGeminiReady()) {
                    await this.toggleMicrophone();
                } else {
                    this.chat.displaySystemNotification('Gemini is not ready yet. Please wait...');
                }
            });
        }
    }

    // --- Internal Helper Methods ---

    /**
     * Get or create a SupabaseDeviceClient for the given device name.
     * @private
     * @param {string} deviceName - Name of the device
     * @returns {SupabaseDeviceClient} The client instance
     */
    _getOrRegisterDeviceClient(deviceName) {
        if (!this._deviceClients.has(deviceName)) {
            const client = new SupabaseDeviceClient(deviceName);
            this._deviceClients.set(deviceName, client);
            Logger.info('Dewab', `Registered new SupabaseDeviceClient for: ${deviceName}`);
        }
        return this._deviceClients.get(deviceName);
    }

    /**
     * Initialize chat interface
     * @private
     */
    _initializeChatInterface() {
        if (this._chatInterface) return;

        const chatLog = this._config.chatLogElement || document.getElementById('chatLog');
        const chatInput = this._config.chatInputElement || document.getElementById('chatInput');
        const sendButton = this._config.sendChatButtonElement || document.getElementById('sendChatButton');
        
        if (!chatLog) {
            Logger.warn('Dewab', 'Chat log element not found. Chat interface may not work.');
        }
        
        this._chatInterface = new ChatInterface(chatLog, chatInput, sendButton);
    }

    /**
     * Initialize Gemini agent and related components
     * @private
     */
    async _initializeGemini() {
        try {
            // Initialize tool manager
            this._toolManager = new UnifiedToolManager(this._toolRegistry, this);
            
            // Initialize Gemini agent
            this._geminiAgent = new GeminiAgent(this._toolManager);
            
            // Prepare config overrides for Gemini
            const geminiConfigOverrides = {};
            if (this._config.systemInstruction) {
                geminiConfigOverrides.systemInstruction = {
                    parts: [{ text: this._config.systemInstruction }]
                };
            }

            // Connect to Gemini
            await this._geminiAgent.connect(geminiConfigOverrides);
            
            this._geminiReady = true;
            
            Logger.info('Dewab', `Gemini initialized with ${this.getToolDeclarations().length} tools`);
            
        } catch (error) {
            Logger.error('Dewab', 'Failed to initialize Gemini:', error);
            this._geminiReady = false;
            throw error;
        }
    }

    /**
     * Sets up event bridging between components and UI
     * @private
     */
    _setupEventBridge() {
        const eventMappings = [
            {
                source: EVENT_TYPES.GEMINI_STATUS_UPDATE,
                handler: (status) => {
                    if (this._chatInterface) {
                        this._chatInterface.displaySystemNotification(status.message);
                    }
                }
            },
            {
                source: EVENT_TYPES.GEMINI_CONNECTED,
                handler: (data) => {
                    if (this._chatInterface) {
                        this._chatInterface.displaySystemNotification(data.message);
                    }
                }
            },
            {
                source: EVENT_TYPES.GEMINI_DISCONNECTED,
                handler: (data) => {
                    if (this._chatInterface) {
                        this._chatInterface.displaySystemNotification(data.message);
                    }
                    this._geminiReady = false;
                }
            },
            {
                source: EVENT_TYPES.GEMINI_ERROR,
                handler: (error) => {
                    if (this._chatInterface) {
                        this._chatInterface.displaySystemNotification(`Error (${error.context}): ${error.message}`);
                    }
                    Logger.error('Dewab', 'Gemini error forwarded to UI:', error);
                }
            },
            {
                source: EVENT_TYPES.GEMINI_TEXT_END,
                handler: () => {
                    if (this._chatInterface) {
                        this._chatInterface.handleGeminiResponseEnd();
                    }
                }
            },
            {
                source: EVENT_TYPES.GEMINI_SYSTEM_MESSAGE,
                handler: (message) => {
                    if (this._chatInterface) {
                        this._chatInterface.displaySystemNotification(message);
                    }
                }
            },
            {
                source: EVENT_TYPES.GEMINI_TOOL_CALL,
                handler: (toolCall) => {
                    const toolName = toolCall.functionCalls?.[0]?.name || 'Unknown tool';
                    if (this._chatInterface) {
                        this._chatInterface.displaySystemNotification(`Gemini is using tool: ${toolName}...`);
                    }
                }
            },
            {
                source: EVENT_TYPES.GEMINI_USER_TRANSCRIPTION,
                handler: (text) => {
                    if (this._chatInterface) {
                        this._chatInterface.handleUserTranscription(text);
                    }
                }
            },
            {
                source: EVENT_TYPES.GEMINI_RESPONSE_TRANSCRIPTION,
                handler: (text) => {
                    if (this._chatInterface) {
                        this._chatInterface.displaySystemNotification(`Gemini: ${text}`);
                    }
                }
            },
            {
                source: EVENT_TYPES.GEMINI_COMPLETE_TEXT_RESPONSE,
                handler: (text) => {
                    if (this._chatInterface) {
                        this._chatInterface.addMessage(text, 'Gemini');
                    }
                }
            },
            // Device events
            {
                source: EVENT_TYPES.DEVICE_ERROR,
                handler: (deviceError) => {
                    if (this._chatInterface) {
                        this._chatInterface.displaySystemNotification(`Device ${deviceError.device}: ${deviceError.message}`);
                    }
                    Logger.warn('Dewab', `Device error from ${deviceError.device}:`, deviceError.message);
                }
            },
            {
                source: EVENT_TYPES.DEVICE_STATE_UPDATED,
                handler: (deviceUpdate) => {
                    Logger.debug('Dewab', `Device ${deviceUpdate.device} state updated`);
                }
            },
            {
                source: EVENT_TYPES.DEVICE_COMMAND_SENT,
                handler: (commandInfo) => {
                    Logger.debug('Dewab', `Command ${commandInfo.command} sent to device ${commandInfo.device}`);
                }
            }
        ];

        eventMappings.forEach(({ source, handler }) => {
            eventBus.on(source, handler);
        });

        Logger.debug('Dewab', `Event bridge setup complete with ${eventMappings.length} mappings`);
    }

    // --- Additional Methods ---

    /**
     * Configure Dewab settings
     * @param {Object} config - Configuration object
     */
    configure(config) {
        this._config = { ...this._config, ...config };
        Logger.info('Dewab', 'Configuration updated', config);
    }
}

export { Dewab, DeviceProxy, ToolRegistry, ChatInterface, SupabaseDeviceClient, UnifiedToolManager, eventBus, EVENT_TYPES }; 