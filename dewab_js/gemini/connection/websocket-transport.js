import { EventEmitter } from 'https://cdn.skypack.dev/eventemitter3';
import { Logger } from '../gemini-utils.js';

/**
 * Pure WebSocket transport layer that handles connection management and raw message transmission.
 * This is protocol-agnostic and could be used for any WebSocket-based API.
 * 
 * Events emitted:
 * - 'open': WebSocket connection established
 * - 'close': WebSocket connection closed  
 * - 'error': Connection or transmission error
 * - 'message': Raw message received (as parsed JSON object)
 */
export class WebSocketTransport extends EventEmitter {
    /**
     * Creates a new WebSocket transport instance
     * @param {string} url - WebSocket URL to connect to
     * @param {string} [name='WebSocketTransport'] - Name for logging purposes
     */
    constructor(url, name = 'WebSocketTransport') {
        super();
        
        this.url = url;
        this.name = name;
        this.ws = null;
        this.isConnecting = false;
        this.connectionPromise = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.reconnectDelay = 1000; // Start with 1 second
        this.isManuallyDisconnected = false;
        
        Logger.debug(this.name, 'WebSocket transport created for URL:', url);
    }

    /**
     * Establishes WebSocket connection
     * @returns {Promise<void>} Resolves when connected, rejects on error
     */
    async connect() {
        if (this.ws?.readyState === WebSocket.OPEN) {
            Logger.debug(this.name, 'Already connected');
            return this.connectionPromise;
        }

        if (this.isConnecting) {
            Logger.debug(this.name, 'Connection already in progress');
            return this.connectionPromise;
        }

        Logger.info(this.name, 'Establishing WebSocket connection...');
        this.isConnecting = true;
        this.isManuallyDisconnected = false;
        
        this.connectionPromise = new Promise((resolve, reject) => {
            const ws = new WebSocket(this.url);
            
            const handleOpen = () => {
                Logger.info(this.name, 'WebSocket connection established');
                this.ws = ws;
                this.isConnecting = false;
                this.reconnectAttempts = 0; // Reset on successful connection
                this.emit('open');
                resolve();
            };
            
            const handleError = (error) => {
                Logger.error(this.name, 'WebSocket connection error:', error);
                this.isConnecting = false;
                this.emit('error', {
                    type: 'connection',
                    error,
                    url: this.url
                });
                reject(error);
            };
            
            const handleMessage = async (event) => {
                try {
                    if (event.data instanceof Blob) {
                        // Convert Blob to JSON for the message handler
                        const text = await event.data.text();
                        const data = JSON.parse(text);
                        this.emit('message', data);
                    } else {
                        // Handle string messages
                        const data = JSON.parse(event.data);
                        this.emit('message', data);
                    }
                } catch (error) {
                    Logger.error(this.name, 'Failed to parse incoming message:', error);
                    this.emit('error', {
                        type: 'message_parse',
                        error,
                        rawData: event.data
                    });
                }
            };
            
            const handleClose = (event) => {
                Logger.warn(this.name, `WebSocket closed. Code: ${event.code}, Reason: '${event.reason}', Clean: ${event.wasClean}`);
                
                // Add more detailed logging for specific close codes
                if (event.code === 1002) {
                    Logger.error(this.name, 'Protocol error - the server terminated the connection due to a protocol error');
                } else if (event.code === 1003) {
                    Logger.error(this.name, 'Unsupported data - the server terminated the connection because it received data it cannot accept');
                } else if (event.code === 1006) {
                    Logger.error(this.name, 'Abnormal closure - no close frame was received');
                } else if (event.code === 1008) {
                    Logger.error(this.name, 'Policy violation - the server terminated the connection because it received a message that violates its policy');
                } else if (event.code === 1009) {
                    Logger.error(this.name, 'Message too big - the server terminated the connection because a data frame was too large');
                } else if (event.code === 1011) {
                    Logger.error(this.name, 'Internal server error');
                }
                
                // Clean up if this is the current WebSocket
                if (this.ws === ws) {
                    this.ws = null;
                    this.isConnecting = false;
                }
                
                this.emit('close', {
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean
                });
                
                // Auto-reconnect if not manually disconnected and not too many attempts
                if (!this.isManuallyDisconnected && 
                    this.reconnectAttempts < this.maxReconnectAttempts &&
                    event.code !== 1000) { // Don't reconnect on normal closure
                    
                    this.scheduleReconnect();
                }
            };
            
            // Attach event listeners
            ws.addEventListener('open', handleOpen);
            ws.addEventListener('error', handleError);
            ws.addEventListener('message', handleMessage);
            ws.addEventListener('close', handleClose);
        });

        return this.connectionPromise;
    }

    /**
     * Schedules an automatic reconnection attempt
     * @private
     */
    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
        
        Logger.info(this.name, `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        
        setTimeout(async () => {
            if (!this.isManuallyDisconnected) {
                try {
                    await this.connect();
                    Logger.info(this.name, 'Reconnection successful');
                } catch (error) {
                    Logger.error(this.name, 'Reconnection failed:', error);
                }
            }
        }, delay);
    }

    /**
     * Disconnects the WebSocket connection
     * @param {boolean} [manual=true] - Whether this is a manual disconnect (prevents auto-reconnect)
     */
    disconnect(manual = true) {
        this.isManuallyDisconnected = manual;
        
        if (this.ws) {
            Logger.info(this.name, manual ? 'Manually disconnecting WebSocket' : 'Disconnecting WebSocket');
            
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(1000, 'Normal closure'); // Use normal closure code
            }
            this.ws = null;
        }
        
        this.isConnecting = false;
        this.connectionPromise = null;
        
        if (manual) {
            this.reconnectAttempts = 0; // Reset reconnect attempts on manual disconnect
        }
    }

    /**
     * Sends a JSON message over the WebSocket
     * @param {object} message - The object to send (will be JSON.stringify'd)
     * @returns {Promise<void>} Resolves when sent, rejects on error
     */
    async sendMessage(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            const error = new Error('WebSocket not connected');
            Logger.warn(this.name, 'Cannot send message - WebSocket not connected');
            throw error;
        }

        try {
            const jsonString = JSON.stringify(message);
            this.ws.send(jsonString);
            Logger.debug(this.name, 'Message sent successfully');
        } catch (error) {
            Logger.error(this.name, 'Failed to send message:', error);
            this.emit('error', {
                type: 'send',
                error,
                message
            });
            throw error;
        }
    }

    /**
     * Gets the current connection state
     * @returns {string} 'connecting', 'open', 'closing', 'closed'
     */
    getConnectionState() {
        if (!this.ws) return 'closed';
        
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'connecting';
            case WebSocket.OPEN: return 'open';
            case WebSocket.CLOSING: return 'closing';
            case WebSocket.CLOSED: return 'closed';
            default: return 'unknown';
        }
    }

    /**
     * Checks if the transport is connected and ready to send messages
     * @returns {boolean}
     */
    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Gets transport status information
     * @returns {object} Status object with connection info
     */
    getStatus() {
        return {
            url: this.url,
            state: this.getConnectionState(),
            isConnecting: this.isConnecting,
            reconnectAttempts: this.reconnectAttempts,
            maxReconnectAttempts: this.maxReconnectAttempts,
            isManuallyDisconnected: this.isManuallyDisconnected
        };
    }
} 