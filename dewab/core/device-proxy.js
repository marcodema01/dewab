import { SupabaseDeviceClient } from './supabase-device-client.js'; // Updated import
import { eventBus, EVENT_TYPES } from '../event-bus.js'; // Updated path
import { Logger } from '../gemini/gemini-utils.js'; // Updated path

/**
 * DeviceProxy provides a fluent interface for device interaction
 */
export class DeviceProxy {
    constructor(dewabApi, deviceName) {
        this.dewabApi = dewabApi; // Main Dewab instance (formerly DewabAPI)
        this.deviceName = deviceName;
        this._client = null;
        this._eventHandlers = new Map();
        this._connectionStatus = 'disconnected';
    }

    /**
     * Send a command to the device
     * @param {string} commandName - Name of the command
     * @param {Object} params - Command parameters
     * @returns {Promise<Object>} Command result
     */
    async sendCommand(commandName, params) {
        const client = this._getClient();
        
        try {
            const result = await client.sendCommand(commandName, params);
            eventBus.emit(EVENT_TYPES.DEVICE_COMMAND_SENT, {
                device: this.deviceName,
                command: commandName,
                params: params,
                success: true
            });
            return result;
        } catch (error) {
            eventBus.emit(EVENT_TYPES.DEVICE_ERROR, {
                device: this.deviceName,
                error: error.message,
                context: 'sendCommand'
            });
            throw error;
        }
    }

    /**
     * Get device state
     * @param {string} [sensorName] - Optional specific sensor/input name
     * @returns {any} Device state or specific sensor value
     */
    getState(sensorName) {
        const client = this._getClient();
        const state = client.getLatestState();
        
        if (!state) return null;
        
        if (sensorName) {
            // Check sensors first, then inputs, then outputs
            return state.sensors?.[sensorName] || 
                   state.inputs?.[sensorName] || 
                   state.outputs?.[sensorName];
        }
        
        return state;
    }

    /**
     * Subscribe to device events
     * @param {string} event - Event name (e.g., 'update', 'connected', 'disconnected')
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this._eventHandlers.has(event)) {
            this._eventHandlers.set(event, new Set());
        }
        
        this._eventHandlers.get(event).add(callback);
        
        // Handle specific event types
        if (event === 'update') {
            const client = this._getClient();
            const channel = client.subscribeToDeviceUpdates((state) => {
                this._emit('update', state);
                eventBus.emit(EVENT_TYPES.DEVICE_STATE_UPDATED, {
                    device: this.deviceName,
                    state: state
                });
            });
            
            // Return unsubscribe function
            return () => {
                this._eventHandlers.get(event).delete(callback);
                if (this._eventHandlers.get(event).size === 0 && channel) {
                    channel.unsubscribe();
                }
            };
        }
        
        // Return generic unsubscribe function
        return () => {
            this._eventHandlers.get(event).delete(callback);
        };
    }

    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback to remove
     */
    off(event, callback) {
        if (this._eventHandlers.has(event)) {
            this._eventHandlers.get(event).delete(callback);
        }
    }

    /**
     * Wait for device to be in a specific state
     * @param {Function} condition - Function that returns true when desired state is reached
     * @param {number} [timeout=30000] - Timeout in milliseconds
     * @returns {Promise<Object>} Resolves with the state when condition is met
     */
    async waitForState(condition, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkState = () => {
                const state = this.getState();
                if (state && condition(state)) {
                    resolve(state);
                    return;
                }
                
                if (Date.now() - startTime > timeout) {
                    reject(new Error(`Timeout waiting for device state on ${this.deviceName}`));
                    return;
                }
                
                // Check again in 100ms
                setTimeout(checkState, 100);
            };
            
            checkState();
        });
    }

    /**
     * Get connection status
     * @returns {string} Connection status ('connected', 'disconnected', 'connecting')
     */
    getConnectionStatus() {
        // This could be enhanced to track actual WebSocket connection status
        const state = this.getState();
        return state ? 'connected' : 'disconnected';
    }

    /**
     * Check if device is online
     * @returns {boolean} True if device has recent state updates
     */
    isOnline() {
        const state = this.getState();
        if (!state || !state.timestamp) return false;
        
        // Consider device online if last update was within 30 seconds
        const lastUpdate = new Date(state.timestamp);
        const now = new Date();
        return (now - lastUpdate) < 30000;
    }

    /**
     * Get device info
     * @returns {Object} Device information
     */
    getInfo() {
        const state = this.getState();
        return {
            name: this.deviceName,
            online: this.isOnline(),
            connectionStatus: this.getConnectionStatus(),
            lastUpdate: state?.timestamp || null,
            capabilities: {
                sensors: state ? Object.keys(state.sensors || {}) : [],
                inputs: state ? Object.keys(state.inputs || {}) : [],
                outputs: state ? Object.keys(state.outputs || {}) : []
            }
        };
    }

    /**
     * Emit event to handlers
     * @private
     */
    _emit(event, data) {
        if (this._eventHandlers.has(event)) {
            this._eventHandlers.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    Logger.error('DeviceProxy', `Error in event handler for ${event}:`, error);
                }
            });
        }
    }

    /**
     * Get or create the SupabaseDeviceClient instance
     * @private
     */
    _getClient() {
        if (!this._client) {
            // Use the main Dewab instance's method to get or create a client
            // This ensures only one client per device across the entire system
            this._client = this.dewabApi._getOrRegisterDeviceClient(this.deviceName);
        }
        return this._client;
    }
} 