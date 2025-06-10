# Dewab: Unified JavaScript Library for AI, Chat, and IoT

Dewab is a JavaScript library designed to simplify the development of interactive applications that combine chat interfaces, real-time device control (e.g., for IoT projects), and integration with Google's Gemini AI. It provides a unified API to manage connections, device commands, chat UI, and AI interactions, making it particularly useful for students and developers prototyping home assistant-like systems.

## Key Features

*   **Unified API**: A single `dewab` object serves as the entry point for all library features.
*   **Device Interaction**: Fluent API for sending commands to and receiving state updates from connected devices (e.g., Arduinos) via Supabase Realtime.
*   **Chat Interface Management**: Helpers for displaying messages, handling user input, and managing streaming responses in a chat UI.
*   **Gemini AI Integration**: Simplifies connecting to Gemini, sending text and voice input, and handling AI responses, including tool calls.
*   **Tool Management**: Easy registration of custom functions and device commands that Gemini can invoke.
*   **Event-Driven**: Uses a central event bus for decoupled communication between components.
*   **Simple Initialization**: One-line setup with automatic connection and error handling.

## Getting Started

### Option 1: One-Line Initialization (Recommended)

The simplest way to get started with Dewab:

```javascript
import { Dewab, eventBus, EVENT_TYPES } from './dewab/index.js';

// One-line initialization with automatic connection
const dewab = await Dewab.create({
    geminiApiKey: 'your-api-key',
    chatLogElement: document.getElementById('chatLog'),
    chatInputElement: document.getElementById('chatInput'),
    sendChatButtonElement: document.getElementById('sendButton')
});

// Ready to use immediately!
await dewab.sendTextMessageToGemini("Hello Gemini!");
```

### Option 2: Manual Initialization with User Gesture

For applications that need user interaction before connecting:

```javascript
import { Dewab, eventBus, EVENT_TYPES } from './dewab/index.js';

const dewab = new Dewab({
    geminiApiKey: 'your-api-key',
    chatLogElement: document.getElementById('chatLog'),
    chatInputElement: document.getElementById('chatInput'),
    sendChatButtonElement: document.getElementById('sendButton')
});

// Connect when user clicks a button
document.getElementById('connectBtn').addEventListener('click', async () => {
    // Option A: Using the simple initialize() method (returns boolean)
    const success = await dewab.initialize();
    if (success) {
        console.log('Connected successfully!');
    }
    
    // Option B: Using connect() directly (throws on error)
    // try {
    //     await dewab.connect();
    //     console.log('Connected successfully!');
    // } catch (error) {
    //     console.error('Connection failed:', error);
    // }
});
```

### Complete Example

```javascript
import { Dewab, eventBus, EVENT_TYPES } from './dewab/index.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Dewab with UI elements
    let dewab;
    try {
        dewab = await Dewab.create({
            geminiApiKey: 'your-gemini-api-key',
            chatLogElement: document.getElementById('chatLog'),
            chatInputElement: document.getElementById('chatInput'),
            sendChatButtonElement: document.getElementById('sendButton')
        });
    } catch (error) {
        console.error('Failed to initialize Dewab:', error);
        return;
    }

    // Register device commands for Gemini to use
    dewab.registerDeviceCommand('SET_LED_STATE', {
        description: 'Control an LED on the Arduino device',
        parameters: {
            led_color: { type: 'string', enum: ['red', 'green'], description: 'LED color' },
            state: { type: 'string', enum: ['on', 'off'], description: 'LED state' }
        }
    });

    // Send chat messages
    document.getElementById('sendButton').addEventListener('click', async () => {
        const input = document.getElementById('chatInput');
        if (input.value && dewab.isGeminiReady()) {
            await dewab.sendTextMessageToGemini(input.value);
        }
    });

    // Control devices directly
    document.getElementById('redLedOnBtn').addEventListener('click', async () => {
        await dewab.device('arduino-nano-esp32_1').sendCommand('SET_LED_STATE', {
            led_color: 'red',
            state: 'on'
        });
    });

    // Listen for device updates
    eventBus.on(EVENT_TYPES.DEVICE_STATE_UPDATED, (data) => {
        console.log(`Device ${data.device} updated:`, data.state);
    });

    // Listen for Gemini responses
    eventBus.on(EVENT_TYPES.GEMINI_COMPLETE_TEXT_RESPONSE, (text) => {
        console.log("Gemini responded:", text);
    });
});
```

## Documentation

For a complete API reference, architecture details, and more examples, please see [documentation.md](./documentation.md). 