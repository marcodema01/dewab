# Dewab Library: Comprehensive Documentation

## 1. Introduction to Dewab

Dewab is a JavaScript library designed to simplify the development of interactive applications that combine chat interfaces, real-time device control (e.g., for IoT projects), and integration with Google's Gemini AI. It provides a unified API to manage connections, device commands, chat UI, and AI interactions, making it particularly useful for students and developers prototyping home assistant-like systems.

**Key Features:**

*   **Unified API**: A single `dewab` object serves as the entry point for all library features.
*   **Device Interaction**: Fluent API for sending commands to and receiving state updates from connected devices (e.g., Arduinos) via Supabase Realtime.
*   **Chat Interface Management**: Helpers for displaying messages, handling user input, and managing streaming responses in a chat UI.
*   **Gemini AI Integration**: Simplifies connecting to Gemini, sending text and voice input, and handling AI responses, including tool calls.
*   **Tool Management**: Easy registration of custom functions and device commands that Gemini can invoke.
*   **Event-Driven**: Uses a central event bus for decoupled communication between components.

## 2. High-Level Architecture

The Dewab library is built on a modular, event-driven architecture to ensure a clean separation of concerns.

```
main.js (Your Application) → Dewab (Unified Interface)
  ├── Dewab → SupabaseDeviceClient (Managed internally for device communication)
  ├── Dewab → GeminiAgent (Managed internally for AI interaction)
  ├── Dewab → ChatInterface (Managed internally for UI)
  └── EventBus → All components communicate via events (loosely coupled)
```

*   **Unified API (`Dewab` class)**: The core of the library, providing a single, clean entry point (`dewab`) for all functionality. It manages the lifecycle and interaction of all other components.
*   **Central Event Bus (`event-bus.js`)**: All components communicate through a central event bus. This decouples the components, meaning the device layer doesn't need to know about the UI layer, for example.
*   **Modular Components**: Functionality is broken into discrete components for WebSocket transport, message handling, feature-specific logic (text, voice, tools), and device communication, making the system easier to maintain, test, and debug.

## 3. Getting Started

Before interacting with devices or Gemini, you need to configure and connect Dewab. The library provides two clear patterns for initialization.

### Option 1: One-Step Initialization (Recommended)

The simplest way to get started. Use this when you can initialize the library as soon as your script runs. It creates an instance and connects in a single step.

```javascript
import { Dewab, eventBus, EVENT_TYPES } from './dewab/index.js';

async function main() {
    try {
        const dewab = await Dewab.create({
            geminiApiKey: 'your-api-key',
            chatLogElement: document.getElementById('chatLog'),
            chatInputElement: document.getElementById('chatInput'),
            sendChatButtonElement: document.getElementById('sendButton')
        });
        
        console.log("Dewab connected and ready!");
        // You can now use the `dewab` instance
        
    } catch (error) {
        console.error("Failed to initialize Dewab:", error);
    }
}

main();
```

### Option 2: Manual Initialization (Advanced)

Use this pattern when you need more control, such as connecting only after a user clicks a button. This is required for web features that need user interaction first, like enabling the microphone.

```javascript
import { Dewab, eventBus, EVENT_TYPES } from './dewab/index.js';

// 1. Create the instance without connecting
const dewab = new Dewab({
    geminiApiKey: 'your-api-key',
    chatLogElement: document.getElementById('chatLog'),
    chatInputElement: document.getElementById('chatInput'),
    sendChatButtonElement: document.getElementById('sendButton')
});

// 2. Connect later, for example on a button click
document.getElementById('connectBtn').addEventListener('click', async () => {
    if (dewab.isConnected()) return;

    try {
        await dewab.connect();
        console.log("Dewab connected successfully!");
        document.getElementById('connectBtn').textContent = 'Connected!';
    } catch (error) {
        console.error("Failed to connect Dewab:", error);
        // Optionally display an error to the user
    }
});
```

## 4. Dewab API Reference

This section details the public API of the Dewab library.

### 4.1. Main `dewab` Object Methods

#### `static async Dewab.create(config)`
**✨ NEW**: Creates and connects a new Dewab instance in one step. This is the recommended way to initialize Dewab for most use cases.
*   **`config: object`**: Configuration object (same as constructor - see constructor documentation below).
*   **Returns**: `Promise<Dewab>` - A connected Dewab instance ready for use.
*   **Throws**: If connection to essential services fails.
*   **Events**: Emits `EVENT_TYPES.GEMINI_CONNECTED` and other status updates via the event bus.

**Example:**
```javascript
const dewab = await Dewab.create({
    geminiApiKey: 'your-api-key',
    chatLogElement: document.getElementById('chatLog')
});
// Ready to use immediately!
```

#### `async dewab.connect()`
Connects to all necessary services, including Supabase for device communication and the Gemini AI service. Initializes internal components like the chat interface and tool manager.
*   **Returns**: `Promise<void>` - Resolves when connections are established and the system is ready.
*   **Throws**: If connection to critical services fails.
*   **Events**: Emits `EVENT_TYPES.GEMINI_CONNECTED` and other status updates via the event bus.

#### `async dewab.disconnect()`
Disconnects from all services and cleans up resources.
*   **Returns**: `Promise<void>` - Resolves when disconnection is complete.
*   **Events**: Emits `EVENT_TYPES.GEMINI_DISCONNECTED`.

#### `dewab.isConnected()`
Checks if the Dewab system is connected to its essential services.
*   **Returns**: `boolean` - `true` if connected, `false` otherwise.

#### `dewab.isGeminiReady()`
Checks if the Gemini agent is initialized and ready for interaction.
*   **Returns**: `boolean` - `true` if Gemini is ready.

#### `dewab.isMicrophoneActive()`
Checks if the microphone is currently active and recording audio.
*   **Returns**: `boolean` - `true` if the microphone is active.

#### `dewab.getStatus()`
Gets a comprehensive status object for the Dewab system.
*   **Returns**: `object` - Contains information like `connected`, `geminiReady`, `microphoneActive`, `registeredTools`, etc.

#### `dewab.registerDeviceCommand(name, definition)`
Registers a command that Gemini can use to control a device.
*   **`name: string`**: The name of the command (e.g., `SET_LED_STATE`). This name will be used by Gemini.
*   **`definition: object`**: An object describing the command:
    *   `description: string`: A natural language description for Gemini.
    *   `parameters: object`: An object defining the parameters Gemini should provide, following a JSON schema-like structure (e.g., `{ "property_name": { "type": "string", "description": "..." } }`).
    *   `handler: async function(deviceName, params)` (optional): A custom handler function. If not provided, Dewab will call `dewab.device(deviceName).sendCommand(name, params)` by default.

#### `dewab.registerFunction(name, definition)`
Registers a custom JavaScript function that Gemini can call.
*   **`name: string`**: The name of the function.
*   **`definition: object`**: An object describing the function:
    *   `description: string`: A natural language description for Gemini.
    *   `parameters: object`: Parameter definitions, similar to `registerDeviceCommand`.
    *   `handler: async function(params)`: The function to execute. Must return a JSON-serializable result.

#### `async dewab.sendTextMessageToGemini(text)`
Sends a text message from the user to the Gemini model. This will also typically display the user's message in the chat UI via `dewab.chat`.
*   **`text: string`**: The text message to send.
*   **Returns**: `Promise<void>` - Resolves when the message is sent.

#### `async dewab.toggleMicrophone()`
Toggles the microphone for voice input to Gemini.
*   **Returns**: `Promise<void>` - Resolves when the toggle action is completed.
*   **Events**: Emits `EVENT_TYPES.AUDIO_MIC_ACTIVATED` or `EVENT_TYPES.AUDIO_MIC_DEACTIVATED`.

#### `dewab.configure(config)`
Allows updating parts of the Dewab configuration after instantiation.
*   **`config: object`**: An object containing configuration keys to update (e.g., `{ defaultDeviceName: 'new-device' }`).

### 4.2. Device API: `dewab.device(deviceName)`

Returns a `DeviceProxy` instance for interacting with a specific device.

#### `async deviceProxy.sendCommand(commandName, params)`
Sends a command to the specified device.
*   **Returns**: `Promise<object>` - Resolves with the acknowledgment from the broadcast service.

#### `deviceProxy.getState([sensorName])`
Gets the latest known state for the target device. If `sensorName` is provided, it attempts to return the value of that specific sensor/input/output.
*   **Returns**: `any` - The full device state object, a specific value, or `null` if no state is available.

#### `deviceProxy.on(event, callback)`
Subscribes to events from the device. The primary event is `'update'`.
*   **Returns**: `function` - An unsubscribe function. Call this to remove the listener.

#### `deviceProxy.off(event, callback)`
Removes a specific event listener.

#### `deviceProxy.isOnline()`
Checks if the device is considered online (based on recent state updates).
*   **Returns**: `boolean`

#### `deviceProxy.getInfo()`
Gets detailed information about the device, including its name, online status, last update timestamp, and capabilities.
*   **Returns**: `object`

### 4.3. Chat API: `dewab.chat`

Provides access to a `ChatInterface` instance for managing the chat UI.

#### `chatInterface.displaySystemNotification(message)`
Displays a system-level message or notification in the chat.

#### `chatInterface.displayUserTypedMessage(messageText)`
Convenience method to display a message typed by the user.

#### `chatInterface.clearChatInput()`
Clears the chat input field.

#### `chatInterface.getChatInput()`
Gets the current value of the chat input field.
*   **Returns**: `string | null`

#### `chatInterface.setChatInputEnabled(enable)`
Enables or disables the chat input field and associated send button.

## 5. Event Handling

Dewab uses a central event bus for inter-component communication and for notifying your application.

**Importing:**
```javascript
import { Dewab, eventBus, EVENT_TYPES } from './dewab/index.js';
```

**Subscribing to an event:**
```javascript
eventBus.on(EVENT_TYPES.SOME_EVENT_NAME, (data) => {
    console.log('Event SOME_EVENT_NAME occurred:', data);
});
```

### Key Event Types (`EVENT_TYPES`)

*   `GEMINI_CONNECTED`: Fired when `dewab.connect()` successfully establishes connection with Gemini services.
*   `GEMINI_DISCONNECTED`: Fired when disconnected from Gemini.
*   `GEMINI_ERROR`: General error from the Gemini agent.
*   `GEMINI_STATUS_UPDATE`: General status updates.
*   `GEMINI_COMPLETE_TEXT_RESPONSE`: Fired when a complete, non-streaming text response is available from Gemini.
*   `GEMINI_USER_TRANSCRIPTION`: User's speech has been transcribed.
*   `GEMINI_TOOL_CALL`: Gemini is requesting a tool to be executed.
*   `AUDIO_MIC_ACTIVATED`: The microphone has been activated for recording.
*   `AUDIO_MIC_DEACTIVATED`: The microphone has been deactivated.
*   `DEVICE_STATE_UPDATED`: A device has broadcasted a new state. `data: { device: string, state: object }`
*   `DEVICE_COMMAND_SENT`: A command has been dispatched to a device.
*   `DEVICE_ERROR`: An error occurred related to device communication.

## 6. Practical Examples

### Example 1: Controlling an LED and Getting Device State

#### Using the New Simplified API (Recommended)

```javascript
import { Dewab, eventBus, EVENT_TYPES } from './dewab/index.js';

const MY_DEVICE = 'arduino-nano-esp32_1';

// Simple one-line initialization
const dewab = await Dewab.create({
    geminiApiKey: 'your-api-key',
    chatLogElement: document.getElementById('chatLog'),
    chatInputElement: document.getElementById('chatInput'),
    sendChatButtonElement: document.getElementById('sendButton')
});

// Register the device command
dewab.registerDeviceCommand('SET_LED_STATE', {
    description: 'Control an LED on the Arduino device',
    parameters: {
        led_color: { type: 'string', enum: ['red', 'green'], description: 'The color of the LED' },
        state: { type: 'string', enum: ['on', 'off'], description: 'The desired state' }
    }
});

// Setup event handlers
document.getElementById('redLedOnBtn').addEventListener('click', async () => {
    await dewab.device(MY_DEVICE).sendCommand('SET_LED_STATE', {
        led_color: 'red',
        state: 'on'
    });
    dewab.chat.displaySystemNotification("Sent RED LED ON command.");
});

// Listen for device state updates
dewab.device(MY_DEVICE).on('update', (state) => {
    console.log(`[${MY_DEVICE}] State Updated:`, state);
    const statusDiv = document.getElementById('deviceStatus');
    if (statusDiv) {
        statusDiv.textContent = `Live Update: ${JSON.stringify(state, null, 2)}`;
    }
});
```

#### Using Traditional Pattern (For User-Gesture Requirements)

```javascript
import { Dewab, eventBus, EVENT_TYPES } from './dewab/index.js';

const MY_DEVICE = 'arduino-nano-esp32_1';

const dewab = new Dewab({
    geminiApiKey: 'your-api-key',
    chatLogElement: document.getElementById('chatLog'),
    chatInputElement: document.getElementById('chatInput'),
    sendChatButtonElement: document.getElementById('sendButton')
});

// Register the device command (can be done before connection)
dewab.registerDeviceCommand('SET_LED_STATE', {
    description: 'Control an LED on the Arduino device',
    parameters: {
        led_color: { type: 'string', enum: ['red', 'green'], description: 'The color of the LED' },
        state: { type: 'string', enum: ['on', 'off'], description: 'The desired state' }
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    const connectButton = document.getElementById('connectBtn');
    const redLedOnButton = document.getElementById('redLedOnBtn');
    const deviceStatusDiv = document.getElementById('deviceStatus');

    // Connect on user action
    connectButton.addEventListener('click', async () => {
        if (!dewab.isConnected()) {
            try {
                await dewab.connect();
                connectButton.textContent = 'Connected!';
                redLedOnButton.disabled = false;
            } catch (error) {
                console.error("Failed to connect:", error);
                connectButton.textContent = 'Connection Failed';
            }
        }
    });

    redLedOnButton.addEventListener('click', async () => {
        if (!dewab.isConnected()) { 
            console.warn("Dewab not connected"); 
            return; 
        }
        await dewab.device(MY_DEVICE).sendCommand('SET_LED_STATE', {
            led_color: 'red',
            state: 'on'
        });
        dewab.chat.displaySystemNotification("Sent RED LED ON command.");
    });

    // Listen for device state updates
    dewab.device(MY_DEVICE).on('update', (state) => {
        console.log(`[${MY_DEVICE}] State Updated:`, state);
        if (deviceStatusDiv) {
            deviceStatusDiv.textContent = `Live Update: ${JSON.stringify(state, null, 2)}`;
        }
    });
});
```

### Example 2: Using Voice Input

```javascript
import { Dewab, eventBus, EVENT_TYPES } from './dewab/index.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Dewab (using any of the patterns from earlier examples)
    const dewab = await Dewab.create({
        geminiApiKey: 'your-api-key',
        chatLogElement: document.getElementById('chatLog')
    });
    
    const micButton = document.getElementById('micBtn');

    micButton.addEventListener('click', async () => {
        if (!dewab.isGeminiReady()) {
            dewab.chat.displaySystemNotification("Gemini not ready for voice input.");
            return;
        }
        await dewab.toggleMicrophone();
    });

    eventBus.on(EVENT_TYPES.AUDIO_MIC_ACTIVATED, () => {
        micButton.textContent = 'Turn Microphone OFF';
        dewab.chat.displaySystemNotification("Microphone ON. Start speaking.");
    });

    eventBus.on(EVENT_TYPES.AUDIO_MIC_DEACTIVATED, () => {
        micButton.textContent = 'Turn Microphone ON';
    });

    eventBus.on(EVENT_TYPES.GEMINI_USER_TRANSCRIPTION, (text) => {
        // The UI is handled by default, but you could add extra logging
        console.log(`User transcription: ${text}`);
    });
});
```

## 7. Troubleshooting

*   **"Dewab not connected" / "Gemini not ready"**:
    *   Ensure `await dewab.connect()` has been called and successfully completed, ideally after a user click.
    *   Check the browser console for connection errors.
*   **Microphone not working**:
    *   Ensure the user has granted microphone permissions.
    *   Check for `AUDIO_ERROR` events or errors in the console related to `AudioContext`.
*   **Device commands not working**:
    *   Verify the `deviceName` is correct and matches the device's name.
    *   Check device-side logs (e.g., Arduino serial monitor).
    *   Listen to `DEVICE_ERROR` events on the event bus.
*   **Tool calls failing**:
    *   Listen to `EVENT_TYPES.GEMINI_TOOL_CALL` to see the exact request from Gemini.
    *   Verify your registered tool `handler` function is correctly processing the arguments. 