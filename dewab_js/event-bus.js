/**
 * Central Event Bus for the entire application
 * Provides a single point of communication between all components
 */
import { EventEmitter } from 'https://cdn.skypack.dev/eventemitter3';

class ApplicationEventBus extends EventEmitter {
    constructor() {
        super();
        this.debugMode = false;
    }

    /**
     * Enable/disable debug logging for all events
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    /**
     * Enhanced emit with optional debug logging
     */
    emit(eventName, data) {
        if (this.debugMode) {
            console.log(`[EventBus] ${eventName}:`, data);
        }
        return super.emit(eventName, data);
    }

    /**
     * Namespace events by component for better organization
     */
    emitNamespaced(namespace, eventName, data) {
        const fullEventName = `${namespace}:${eventName}`;
        return this.emit(fullEventName, data);
    }

    /**
     * Subscribe to namespaced events
     */
    onNamespaced(namespace, eventName, callback) {
        const fullEventName = `${namespace}:${eventName}`;
        return this.on(fullEventName, callback);
    }
}

// Export a singleton instance
export const eventBus = new ApplicationEventBus();

// Define all event types in one place for documentation and IDE support
export const EVENT_TYPES = {
    // Gemini Agent Events
    GEMINI_CONNECTED: 'gemini:connected',
    GEMINI_DISCONNECTED: 'gemini:disconnected', 
    GEMINI_ERROR: 'gemini:error',
    GEMINI_STATUS_UPDATE: 'gemini:status_update',
    GEMINI_TEXT_START: 'gemini:text_start',
    GEMINI_TEXT_CHUNK: 'gemini:text_chunk',
    GEMINI_TEXT_END: 'gemini:text_end',
    GEMINI_SYSTEM_MESSAGE: 'gemini:system_message',
    GEMINI_TOOL_CALL: 'gemini:tool_call',
    GEMINI_USER_TRANSCRIPTION: 'gemini:user_transcription',
    GEMINI_RESPONSE_TRANSCRIPTION: 'gemini:response_transcription',
    GEMINI_COMPLETE_TEXT_RESPONSE: 'gemini:complete_text_response',
    GEMINI_AUDIO_CHUNK: 'gemini:audio_chunk',
    
    // Audio Events
    AUDIO_MIC_ACTIVATED: 'audio:mic_activated',
    AUDIO_MIC_DEACTIVATED: 'audio:mic_deactivated',
    AUDIO_RECORDING_STOPPED: 'audio:recording_stopped',
    AUDIO_ERROR: 'audio:error',
    AUDIO_STATUS_UPDATE: 'audio:status_update',
    
    // Device Events  
    DEVICE_STATE_UPDATED: 'device:state_updated',
    DEVICE_COMMAND_SENT: 'device:command_sent',
    DEVICE_ERROR: 'device:error',
    
    // UI Events
    UI_STATUS_UPDATE: 'ui:status_update',
    UI_CHAT_MESSAGE: 'ui:chat_message',
    UI_ERROR_DISPLAY: 'ui:error_display'
}; 