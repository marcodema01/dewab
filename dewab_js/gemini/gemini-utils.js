/**
 * @file Utility functions for the Gemini client, primarily for data type conversions.
 */

/**
 * Converts a Blob object to a JSON object using FileReader.
 * Useful for processing blob data received from APIs like Gemini.
 * @param {Blob} blob - The Blob object to convert.
 * @returns {Promise<object>} Promise resolving to the parsed JSON object, or rejecting on error.
 */
export function blobToJSON(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = () => {
            if (reader.result) {
                // Parse the FileReader result into JSON
                resolve(JSON.parse(reader.result));
            } else {
                reject('Failed to parse blob to JSON');
            }
        };
        
        // Initiate blob reading as text
        reader.readAsText(blob);
    });
}

/**
 * Converts a base64 encoded string to an ArrayBuffer.
 * This is often needed for handling binary data (like audio) from Gemini responses.
 * @param {string} base64 - The base64 encoded string.
 * @returns {ArrayBuffer} ArrayBuffer containing the decoded binary data.
 */
export function base64ToArrayBuffer(base64) {
    // Decode base64 to binary string
    const binaryString = atob(base64);
    
    // Create buffer to hold binary data
    const bytes = new Uint8Array(binaryString.length);
    
    // Convert binary string to byte array
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    return bytes.buffer;
}

/**
 * Converts an ArrayBuffer to a base64 encoded string.
 * Useful for sending binary data (e.g., audio chunks) to the Gemini API.
 * @param {ArrayBuffer} buffer - The ArrayBuffer to convert.
 * @returns {string} Base64 encoded string representation of the buffer, or undefined on error.
 */
export function arrayBufferToBase64(buffer) {
    try {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        // Convert each byte to binary string
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    } catch (error) {
        // Logger is defined in this same file, so it should always be available
        if (Logger && Logger.error) {
            Logger.error('Utils', 'Failed to convert array buffer to base64:', error.message);
        } else {
            console.error('Failed to convert array buffer to base64: ' + error.message);
        }
    }
}

/**
 * Enhanced Logger utility with centralized error handling capabilities.
 * Provides timestamped console logging and structured error management.
 */
export const Logger = {
    // Event bus will be dynamically imported to avoid circular dependencies
    _eventBus: null,
    _EVENT_TYPES: null,

    /**
     * Initialize the Logger with event bus for error emission
     * @param {object} eventBus - The application event bus
     * @param {object} EVENT_TYPES - Event type constants
     */
    async _initializeEventBus() {
        if (!this._eventBus) {
            try {
                const { eventBus, EVENT_TYPES } = await import('../event-bus.js');
                this._eventBus = eventBus;
                this._EVENT_TYPES = EVENT_TYPES;
            } catch (error) {
                console.warn('Logger: Could not import event bus, error events will not be emitted:', error);
            }
        }
    },

    _log(level, context, ...args) {
        const now = new Date();
        const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
        
        let logFn = console.log; // Default to console.log
        if (level === 'error' && console.error) logFn = console.error;
        else if (level === 'warn' && console.warn) logFn = console.warn;
        else if (level === 'info' && console.info) logFn = console.info;
        else if (level === 'debug' && console.debug) logFn = console.debug;

        if (context) {
            logFn(`[${timestamp}] [${context}]`, ...args);
        } else {
            logFn(`[${timestamp}]`, ...args);
        }
    },

    debug(context, ...args) {
        this._log('debug', context, ...args);
    },

    info(context, ...args) {
        this._log('info', context, ...args);
    },

    warn(context, ...args) {
        this._log('warn', context, ...args);
    },

    error(context, ...args) {
        this._log('error', context, ...args);
    },

    log(context, ...args) { // General log, maps to console.log
        this._log('log', context, ...args);
    },

    /**
     * Centralized error handling with logging, event emission, and optional throwing
     * @param {Error} error - The error that occurred
     * @param {object} options - Error handling options
     * @param {string} options.component - Component name (e.g., 'GeminiAgent')
     * @param {string} options.operation - Operation that failed (e.g., 'sendText')
     * @param {string} [options.context] - Error context (defaults to operation)
     * @param {boolean} [options.throwAfter=false] - Whether to throw the error after logging/emitting
     * @param {boolean} [options.emitEvents=true] - Whether to emit error events to event bus
     * @param {string} [options.customMessage] - Custom error message (defaults to error.message)
     */
    handleError(error, options = {}) {
        const {
            component,
            operation,
            context = operation,
            throwAfter = false,
            emitEvents = true,
            customMessage
        } = options;

        // Validate required parameters
        if (!component || !operation) {
            throw new Error('Logger.handleError requires component and operation parameters');
        }

        // Create standardized error message
        const errorMessage = customMessage || error.message || 'Unknown error';
        const fullMessage = `${operation === context ? operation : `${operation} (${context})`}: ${errorMessage}`;
        
        // Log the error
        this.error(component, fullMessage, error);

        // Create standardized error payload
        const errorPayload = {
            context,
            message: errorMessage,
            errorObj: error
        };

        // Emit to event bus if enabled (async but don't wait)
        if (emitEvents) {
            this._initializeEventBus().then(() => {
                if (this._eventBus && this._EVENT_TYPES) {
                    this._eventBus.emit(this._EVENT_TYPES.GEMINI_ERROR, errorPayload);
                }
            }).catch(() => {
                // Ignore event bus errors to avoid infinite loops
            });
        }

        // Throw if requested
        if (throwAfter) {
            throw error;
        }
    },

    /**
     * Handle recoverable errors that don't break application flow
     * @param {Error} error - The error that occurred
     * @param {object} options - Error handling options (same as handleError)
     * @param {function} [options.recoveryAction] - Optional recovery function to execute
     */
    handleRecoverableError(error, options = {}) {
        const { recoveryAction, ...errorOptions } = options;
        
        // Force throwAfter to false for recoverable errors
        this.handleError(error, { ...errorOptions, throwAfter: false });
        
        // Execute recovery action if provided
        if (typeof recoveryAction === 'function') {
            try {
                recoveryAction();
                this.info(options.component, `Recovery action completed for ${options.operation}`);
            } catch (recoveryError) {
                this.error(options.component, `Recovery action failed for ${options.operation}:`, recoveryError);
            }
        }
    },

    /**
     * Handle critical errors that require immediate attention
     * @param {Error} error - The critical error that occurred
     * @param {object} options - Error handling options (same as handleError, throwAfter defaults to true)
     */
    handleCriticalError(error, options = {}) {
        // Force throwAfter to true for critical errors unless explicitly set to false
        const throwAfter = options.throwAfter !== false;
        
        this.handleError(error, { ...options, throwAfter });
        
        // Additional critical error logging
        this.error(options.component, `🚨 CRITICAL ERROR in ${options.operation}:`, error);
    }
};

/**
 * Converts a PCM16 Int16Array to a base64 encoded string.
 * @param {Int16Array} pcm16Array - The PCM16 data.
 * @returns {string} The base64 encoded string.
 */
export function PCM16toString(pcm16Array) {
    let binary = '';
    for (let i = 0; i < pcm16Array.length; i++) {
        const val = pcm16Array[i];
        binary += String.fromCharCode(val & 0xFF, (val >> 8) & 0xFF);
    }
    return btoa(binary);
}

/**
 * Converts a base64 encoded string back to a PCM16 Int16Array.
 * @param {string} base64String - The base64 encoded string.
 * @returns {Int16Array} The PCM16 data.
 */
export function stringToPCM16(base64String) {
    const binaryString = atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
} 