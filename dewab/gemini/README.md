# Gemini Voice Client Library

## 1. Overview

This client library facilitates real-time, two-way communication with Google's Gemini API via WebSockets. It is designed for building voice and text-based chat applications, providing a structured way to send user input (text, and eventually audio) and receive responses from the Gemini model, including text transcriptions and audio output.

The library abstracts the complexities of WebSocket management and the Gemini API's specific message an_input_audio_chunking_protocols, offering a higher-level, event-driven interface for application developers.

## 2. Core Philosophy and Design (The "Why")

The primary goal of this library is to provide a **modular and reusable client** for interacting with the Gemini API, keeping the client logic separate from the main application's UI or specific business logic.

Key design principles include:

*   **Modularity & Separation of Concerns:**
    *   The client (`dewab/gemini/`) is self-contained.
    *   The main application (e.g., `main.js`, `index.html`) interacts with the client through a well-defined API, listening to events and calling its methods. This allows the client to be potentially reused in different projects with different UIs.
*   **Event-Driven Architecture:**
    *   The `GeminiAgent` (the main interface of the library) emits events for various occurrences (e.g., receiving text chunks, connection status changes, errors).
    *   This decouples the client from the UI. The UI simply subscribes to these events and updates itself accordingly, rather than having the client directly manipulate UI elements. This makes the client more versatile and the overall application easier to manage.
*   **Abstraction Layers:**
    *   **`GeminiWebsocketClient`:** This lower-level class handles the direct WebSocket communication, including connection establishment, sending and receiving raw messages according to the Gemini API's binary/JSON format, and handling basic API message types (like `setupComplete`, `toolCall`, raw `serverContent`). It acts as a foundational layer.
    *   **`GeminiAgent`:** This higher-level class builds upon `GeminiWebsocketClient`. It orchestrates the chat flow, manages audio recording and streaming, tool call handling, and emits more semantically meaningful events tailored for a chat application (e.g., `gemini_text_start`, `gemini_text_chunk`, `gemini_text_end`, `gemini_user_transcription`). It simplifies interaction for the main application integrating Gemini functionalities.
*   **Configuration Management:**
    *   `gemini-config.js` centralizes API keys, WebSocket URLs, and default Gemini model parameters. This makes it easier to update settings without sifting through operational code. (In a production scenario, API keys should be handled more securely, e.g., via a backend proxy or environment variables not committed to the repository).
*   **Utility Functions:**
    *   `gemini-utils.js` provides common helper functions (like `blobToJSON`, `base64ToArrayBuffer`) needed for processing messages to and from the API, keeping other files cleaner.

## 3. Architecture and Components (The "How")

The library consists of the following key files within the `dewab/gemini/` directory:

*   **`gemini-agent.js` (`GeminiAgent` class):**
    *   **Purpose:** This is the primary public interface of the library. Application code (like `gemini-integration.js`) will instantiate and interact with this class.
    *   **Responsibilities:**
        *   Manages the overall connection lifecycle (`connect`, `initialize`, `disconnect`).
        *   Provides methods to send data to Gemini (e.g., `sendText`).
        *   Listens to events from `GeminiWebsocketClient` and processes them into higher-level, application-friendly events (e.g., transforming raw content parts into text stream events).
        *   Manages state related to the conversation flow (e.g., tracking if a new text stream from Gemini has started).
*   **`gemini-websocket-client.js` (`GeminiWebsocketClient` class):**
    *   **Purpose:** Handles the low-level WebSocket connection and message framing specific to the Gemini API.
    *   **Responsibilities:**
        *   Establishing and terminating the WebSocket connection.
        *   Sending JSON-formatted messages (setup, client content, tool responses) to the API.
        *   Receiving binary (Blob) messages from the API, converting them to JSON.
        *   Parsing the structure of Gemini API responses and emitting events for different types of server content (`toolCall`, `serverContent` containing text/audio, `setupComplete`, etc.).
*   **`gemini-config.js`:**
    *   **Purpose:** Stores configuration details.
    *   **Responsibilities:**
        *   Provides the WebSocket URL (including the API key).
        *   Defines the default configuration object sent to Gemini during session setup (model parameters, safety settings, transcription options).
*   **`gemini-utils.js`:**
    *   **Purpose:** Contains helper functions used across the library.
    *   **Responsibilities:**
        *   Data conversion utilities (e.g., `blobToJSON`, `base64ToArrayBuffer`, `arrayBufferToBase64`).

## 4. Interaction Flow (Conceptual Diagram)

This diagram illustrates the typical flow of communication when a user sends a message and receives a streaming text response:

```
+-------------------+     +-------------------------+     +-----------------------+     +-------------------------+     +-----------------+
| UI / Main App     | --> | Dewab (Unified API)     | --> | GeminiAgent           | --> | GeminiWebsocketClient   | --> | Google Gemini   |
| (e.g., main.js)   |     | (gemini-integration.js) |     | (gemini-agent.js)     |     | (gemini-websocket...)   |     | API (WebSocket) |
+-------------------+     +-------------------------+     +-----------------------+     +-------------------------+     +-----------------+
        |                             |                             |                             |                             |
        | 1. User types message,      |                             |                             |                             |
        |    clicks "Send"            |                             |                             |                             |
        |---------------------------->| 2. sendText(userInput)      |                             |                             |
        |                             |---------------------------->| 3. sendText(userInput)      |
        |                             |                             | (formats for API)           |
        |                             |                             |---------------------------->| 4. Sends JSON
        |                             |                             |                             |   message
        |                             |                             |                             |
        |                             |                             |                             |<-- 5. Receives Blob
        |                             |                             |<-- 6. Processes Blob, emits |
        |                             |                             |    'content' event (part 1)|
        |                             |<-- 7. Receives 'content',  |                             |
        |                             |    emits 'gemini_text_start'|                             |
        |<----------------------------| 8. UI handles event,        |                             |
        |    displays first chunk     |    creates/updates message  |                             |
        |                             |                             |                             |
        |                             |                             |                             |<-- 9. Receives Blob
        |                             |                             |<-- 10. Processes Blob, emits|
        |                             |                             |     'content' event (part 2)|
        |                             |<-- 11. Receives 'content', |                             |
        |                             |     emits 'gemini_text_chunk'|                             |
        |<----------------------------| 12. UI handles event,       |                             |
        |    appends to message       |     appends to message      |                             |
        |                             |                             |                             |
        |                             | (Repeats for all chunks)    |                             |
        |                             |                             |                             |
        |                             |                             |                             |<-- 13. Receives
        |                             |                             |<-- 14. Processes, emits     |     TurnComplete
        |                             |                             |     'turn_complete'         |
        |                             |<-- 15. Receives, emits      |                             |
        |                             |     'gemini_text_end' and   |                             |
        |                             |     'gemini_system_message' |                             |
        |<----------------------------| 16. UI handles events,      |                             |
        |    finalizes message,       |     finalizes message, logs |                             |
        |    logs system message      |     system message          |                             |
        |                             |                             |                             |
```

## 5. Basic Usage (Example from a UI perspective like `main.js`)

```javascript
import { dewab } from './dewab/index.js';
import { eventBus, EVENT_TYPES } from './dewab/event-bus.js';

// 1. Register device commands and functions
dewab.registerDeviceCommand('SET_LED_STATE', {
    description: 'Control LED state on device',
    parameters: {
        led_color: { type: 'string', enum: ['red', 'green'] },
        state: { type: 'string', enum: ['on', 'off'] }
    }
});

dewab.registerFunction('get_time', {
    description: 'Get current time',
    parameters: {},
    handler: async () => ({ time: new Date().toLocaleTimeString() })
});

// 2. Setup event listeners using the centralized event bus
eventBus.on(EVENT_TYPES.GEMINI_STATUS_UPDATE, (status) => {
    // Handle status updates like "Connected", "Initialized", "Disconnected"
    console.log('[SYSTEM_STATUS]:', status.message);
});

eventBus.on(EVENT_TYPES.GEMINI_ERROR, (error) => {
    // Handle errors
    console.error('[GEMINI_ERROR]:', error.context, error.message);
});

eventBus.on(EVENT_TYPES.GEMINI_COMPLETE_TEXT_RESPONSE, (text) => {
    // Handle complete text responses from Gemini
    console.log('[GEMINI_RESPONSE]:', text);
});

eventBus.on(EVENT_TYPES.GEMINI_SYSTEM_MESSAGE, (message) => {
    // Handle system messages like "Model turn complete"
    console.log('[GEMINI_SYSTEM]:', message);
});

// 3. Connect and initialize (typically triggered by user gesture)
async function startGeminiAgent() {
    try {
        await dewab.connect();
        // Now ready to send messages
    } catch (error) {
        console.error("Failed to start Gemini agent:", error);
    }
}

// 4. Send a text message
async function sendUserMessage(text) {
    try {
        await dewab.sendTextMessageToGemini(text);
    } catch (error) {
        console.error("Failed to send message:", error);
    }
}

// 5. Control devices
const device = dewab.device('my-device-name');
await device.sendCommand('SET_LED_STATE', { led_color: 'red', state: 'on' });

// 6. Use chat interface
dewab.chat.displaySystemNotification('System ready!');
```

## 6. Future Development Considerations

*   **Audio Input/Output:** Integrate microphone input for sending user speech and audio playback for Gemini's spoken responses. This would involve handling the `gemini_audio_chunk` events more thoroughly and adding methods to `GeminiAgent` to stream user audio.
*   **Tool Usage:** Implement full support for declaring and handling function calls (tools) requested by the Gemini model.
*   **Advanced Settings Management:** Allow runtime configuration of more Gemini parameters (temperature, voice, etc.) perhaps through a settings UI that updates the config used by `GeminiWebsocketClient` (passed during `connect` of `GeminiAgent`).
*   **Robust Error Handling:** Enhance error reporting and potentially add retry mechanisms for transient connection issues.

---
This README provides a foundational understanding of the Gemini Voice Client library. As the library evolves, this documentation should be updated to reflect new features and changes in its architecture or usage. 