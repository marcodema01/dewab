# Build a Full-Stack AIoT App in Minutes: Control Your Arduino with AI

Imagine using plain English to control electronics anywhere in the world. "Turn on the red light." "What's the temperature?" Sounds like science fiction? Not anymore.

In this tutorial, we'll build a complete "AIoT" (Artificial Intelligence of Things) application from scratch. We'll create a web-based chat interface that lets you talk to Google's powerful Gemini AI. This AI will be able to control LEDs connected to an Arduino. As a bonus, we'll add a physical button to our Arduino that can trigger the AI to fetch a random Kanye West quote and display it in our chat.

The secret sauce that makes this all possible with surprisingly little code is **Dewab**, a library designed to be the ultimate glue between web services, AI, and IoT hardware.

Here's a preview of what we're building:

*   **A Web UI:** A chat box to talk to a Gemini-powered assistant.
*   **An IoT Device:** An Arduino with two LEDs you can control and a button that can send signals back to the web UI.
*   **Two-Way Communication:** The web app controls the Arduino, and the Arduino can trigger actions in the web app.

Ready to build the future? Let's dive in.

## Prerequisites

Before we start, make sure you have the following:

*   **Hardware:**
    *   An ESP32-based Arduino board (like an Arduino Nano ESP32).
    *   A push-button.
    *   Two LEDs (we used red and yellow).
    *   A breadboard and some jumper wires.
*   **Software:**
    *   The [Arduino IDE](https://www.arduino.cc/en/software). Make sure you've installed the board support for your ESP32 board.
    *   A modern web browser like Chrome or Firefox.
*   **Cloud Services:**
    *   **Gemini API Key:** Get one from [Google AI Studio](https://aistudio.google.com/app/apikey).
    *   **Supabase Account:** We'll use Supabase for real-time communication. Create a free account and a new project at [supabase.com](https://supabase.com). You'll need your project's **URL** and **anon key**.

## Part 1: Programming the "Thing" — Our Arduino

First, let's get our hardware smart and connected. We'll program the ESP32 to define its components, connect to WiFi, and listen for commands from our web app.

### 1.1: Setting Up The Circuit

Before we code, let's wire things up.
1.  Place your ESP32 on the breadboard.
2.  Connect the two LEDs to two separate digital pins. Remember to use a resistor for each to protect them. We're using pins `A6` and `A7` in our code. Connect the long leg (anode) to the pin and the short leg (cathode) to Ground (GND).
3.  Connect the push-button. One leg goes to a digital pin (we're using `D2`), and the other leg goes to Ground (GND). We'll use the ESP32's internal pull-up resistor, so we don't need an external one.

### 1.2: Creating the Sketch

Open your Arduino IDE and create a new sketch. Save it, and let's start building our code, piece by piece.

#### The `config.h` file
To keep our sensitive credentials separate from our main code, we'll use a `config.h` file. In the Arduino IDE, create a new tab (click the little arrow below the serial monitor icon and select "New Tab") and name it `config.h`. Paste the following into it, and be sure to fill in your own credentials.

```cpp
// config.h
#pragma once

// -- Device Info: A unique name for your device
#define DEVICE_NAME "arduino-nano-esp32_1"

// -- WiFi Credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// -- Supabase Credentials
#define SUPABASE_REF "YOUR_SUPABASE_PROJECT_REF" // From Project URL (e.g., "abcdefgh...")
#define SUPABASE_KEY "YOUR_SUPABASE_ANON_KEY"   // Your project's anon key
```

#### Includes and Global Definitions
Now, back in your main sketch file. At the very top, we need to include the libraries we'll be using and define our hardware pins.

```cpp
#include <Arduino.h>
#include <ArduinoJson.h>
#include "Dewab.h"
#include "config.h" // Our new config file!

// Create a Dewab instance. It will manage all communication.
Dewab dewab(DEVICE_NAME, WIFI_SSID, WIFI_PASSWORD, SUPABASE_REF, SUPABASE_KEY);

// --- Hardware Setup ---
// Define which Arduino pins are connected to your components.
const int BUTTON_D2_PIN = 2;   // Button connected to pin D2
const int LED_RED_PIN = A7;    // Red LED connected to pin A7
const int LED_YELLOW_PIN = A6; // Yellow LED connected to pin A6

// --- Device State ---
// Variables to keep track of the current state of our hardware.
bool currentButtonD2State = false;
bool currentLedRedState = false;
bool currentLedYellowState = false;

// Forward declaration for a function we'll write soon
void readAndProcessInputs();
```
We create a single `dewab` object, passing in all the credentials from `config.h`. This one object is our gateway to the cloud. We also set up variables to hold the current state of our button and LEDs.

#### The `setup()` function: One-time Configuration
The `setup()` function runs once when the Arduino boots up. Here, we'll initialize our pins and, most importantly, tell `Dewab` how to handle events using **callbacks**.

```cpp
void setup() {
    Serial.begin(115200);

    // --- Pin Initialization ---
    pinMode(BUTTON_D2_PIN, INPUT_PULLUP); // Button pin is an input
    pinMode(LED_RED_PIN, OUTPUT);         // LED pins are outputs
    pinMode(LED_YELLOW_PIN, OUTPUT);
    digitalWrite(LED_RED_PIN, LOW);       // Turn LEDs off initially
    digitalWrite(LED_YELLOW_PIN, LOW);

    // --- Dewab Callbacks ---
    // Here we tell Dewab what functions to run for specific events.

    // 1. When another client asks for our state, run this function:
    dewab.onStateUpdateRequest([&](JsonDocument& doc) {
        dewab.stateAddBool(doc, "inputs", "button_d2", currentButtonD2State);
        dewab.stateAddBool(doc, "outputs", "led_red", currentLedRedState);
        dewab.stateAddBool(doc, "outputs", "led_yellow", currentLedYellowState);
    });

    // 2. When we receive a "set_outputs" command, run this function:
    dewab.registerCommand("set_outputs", [&](const JsonObjectConst& payload, JsonDocument& replyDoc) {
        bool stateChanged = false;

        // Check if the command includes instructions for the red LED.
        if (payload.containsKey("led_red")) {
            bool newLedState = payload["led_red"];
            if (newLedState != currentLedRedState) {
                currentLedRedState = newLedState;
                digitalWrite(LED_RED_PIN, currentLedRedState ? HIGH : LOW);
                stateChanged = true;
            }
        }

        // Check if the command includes instructions for the yellow LED.
        if (payload.containsKey("led_yellow")) {
            bool newLedState = payload["led_yellow"];
            if (newLedState != currentLedYellowState) {
                currentLedYellowState = newLedState;
                digitalWrite(LED_YELLOW_PIN, currentLedYellowState ? HIGH : LOW);
                stateChanged = true;
            }
        }
        
        // If we changed anything, tell Dewab to broadcast the new state to all listeners.
        if (stateChanged) {
            dewab.broadcastCurrentState("outputs_changed_by_command");
        }

        // Send a reply to acknowledge the command was processed.
        replyDoc["led_red_state"] = currentLedRedState;
        replyDoc["led_yellow_state"] = currentLedYellowState;
        return true; // Indicate success
    });
    
    // --- Start Dewab ---
    // This connects to WiFi and Supabase.
    dewab.begin();

    // Read the initial state of the inputs at startup.
    readAndProcessInputs();
}
```
*   `onStateUpdateRequest`: This is our device's way of saying, "Here's what I'm doing right now." When our web app connects, it will ask for the device's status, and Dewab will trigger this function to get the data.
*   `registerCommand("set_outputs", ...)`: This is the core of our remote control. We're telling Dewab that we can accept a command named `"set_outputs"`. When our web app sends this command (we'll build that in Part 2), this code will run, turning the LEDs on or off. If a state changes, we call `dewab.broadcastCurrentState()` to let everyone know.

Finally, `dewab.begin()` kicks everything off, connecting to the network and our cloud services.

#### The `loop()` and `readAndProcessInputs()` functions
The `loop()` is the heartbeat of our sketch. It needs to run over and over.

```cpp
void loop() {
    // This keeps the cloud connection alive and processes incoming messages.
    dewab.loop();

    // This checks our physical hardware for changes.
    readAndProcessInputs();
    
    delay(50); // A small delay to keep things running smoothly.
}

// This function reads the state of the button.
void readAndProcessInputs() {
    // Read the button state (INPUT_PULLUP means LOW is pressed).
    bool isButtonPressed = (digitalRead(BUTTON_D2_PIN) == LOW);

    // If the button state has changed since last time we checked...
    if (isButtonPressed != currentButtonD2State) {
        currentButtonD2State = isButtonPressed;
        // ...broadcast the new state to the cloud!
        dewab.broadcastCurrentState("button_state_changed");
    }
}
```
It's simple but powerful. `dewab.loop()` does all the heavy lifting of maintaining the connection. Our custom `readAndProcessInputs()` function checks if the physical button has been pressed. If it has, `dewab.broadcastCurrentState()` sends the update to the cloud for our web app to see.

### 1.3: The Complete Arduino Sketch
Here is the final code for your main `.ino` file. You can copy and paste this to make sure you have everything.

```cpp
#include <Arduino.h>
#include <ArduinoJson.h>
#include "Dewab.h"
#include "config.h" // Stores your WiFi and Supabase credentials

// Create a Dewab instance. It will manage all communication.
// It needs your device name, WiFi and Supabase details from config.h
Dewab dewab(DEVICE_NAME, WIFI_SSID, WIFI_PASSWORD, SUPABASE_REF, SUPABASE_KEY);

// --- Hardware Setup ---
// Define which Arduino pins are connected to your components.
const int BUTTON_D2_PIN = 2;   // Button connected to pin D2
const int LED_RED_PIN = A7;    // Red LED connected to pin A7
const int LED_YELLOW_PIN = A6; // Yellow LED connected to pin A6

// --- Device State ---
// Variables to keep track of the current state of our hardware.
bool currentButtonD2State = false;
bool currentLedRedState = false;
bool currentLedYellowState = false;

// Forward declaration for our local input function
void readAndProcessInputs();

void setup() {
    Serial.begin(115200);

    // --- Pin Initialization ---
    // Set up the hardware pins for use.
    pinMode(BUTTON_D2_PIN, INPUT_PULLUP); // Button pin is an input
    pinMode(LED_RED_PIN, OUTPUT);         // LED pins are outputs
    pinMode(LED_YELLOW_PIN, OUTPUT);
    digitalWrite(LED_RED_PIN, LOW);       // Turn LEDs off initially
    digitalWrite(LED_YELLOW_PIN, LOW);

    // --- Dewab Callbacks ---
    // Tell Dewab what to do for specific events.

    // This function is called when Dewab needs to know the device's current state.
    // We fill a JSON document with our state variables.
    dewab.onStateUpdateRequest([&](JsonDocument& doc) {
        dewab.stateAddBool(doc, "inputs", "button_d2", currentButtonD2State);
        dewab.stateAddBool(doc, "outputs", "led_red", currentLedRedState);
        dewab.stateAddBool(doc, "outputs", "led_yellow", currentLedYellowState);
    });

    // This function is called when a "set_outputs" command arrives from the cloud.
    // The 'payload' contains the instructions (e.g., which LED to turn on).
    dewab.registerCommand("set_outputs", [&](const JsonObjectConst& payload, JsonDocument& replyDoc) {
        bool stateChanged = false;

        // Check if the command includes instructions for the red LED.
        if (payload.containsKey("led_red")) {
            bool newLedState = payload["led_red"];
            if (newLedState != currentLedRedState) {
                currentLedRedState = newLedState;
                digitalWrite(LED_RED_PIN, currentLedRedState ? HIGH : LOW);
                stateChanged = true;
            }
        }

        // Check if the command includes instructions for the yellow LED.
        if (payload.containsKey("led_yellow")) {
            bool newLedState = payload["led_yellow"];
            if (newLedState != currentLedYellowState) {
                currentLedYellowState = newLedState;
                digitalWrite(LED_YELLOW_PIN, currentLedYellowState ? HIGH : LOW);
                stateChanged = true;
            }
        }
        
        // If we changed anything, tell Dewab to broadcast the new state to all listeners.
        if (stateChanged) {
            dewab.broadcastCurrentState("outputs_changed_by_command");
        }

        // Send a reply to acknowledge the command was processed.
        replyDoc["led_red_state"] = currentLedRedState;
        replyDoc["led_yellow_state"] = currentLedYellowState;
        return true; // Indicate success
    });
    
    // --- Start Dewab ---
    // This connects to WiFi and Supabase.
    dewab.begin();

    // Read the initial state of the inputs at startup.
    readAndProcessInputs();
}

void loop() {
    // This is the heart of the program.
    // dewab.loop() keeps the connection alive and processes incoming messages.
    dewab.loop();

    // We also need to keep checking our local hardware for changes.
    readAndProcessInputs();
    
    delay(50); // A small delay to prevent the loop from running too fast.
}

// --- Local Hardware Interaction ---
// This function reads the state of the button.
void readAndProcessInputs() {
    // Read the button state (INPUT_PULLUP means LOW is pressed).
    bool isButtonPressed = (digitalRead(BUTTON_D2_PIN) == LOW);

    // If the button state has changed since last time we checked...
    if (isButtonPressed != currentButtonD2State) {
        currentButtonD2State = isButtonPressed;
        // ...broadcast the new state to the cloud.
        dewab.broadcastCurrentState("button_state_changed");
    }
}
```

With this sketch loaded, our Arduino is on the grid, ready for action.

## Part 2: The Brains and Face — The Web App

Now, let's build the user-facing side of our application. This is a simple HTML/JS application that runs entirely in the browser. It will provide the chat interface and host the AI logic.

### 2.1: The HTML Foundation
Create a folder for your web app. Inside it, create an `index.html` file. This provides the basic structure for our chat window.

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AIoT Chat with Arduino</title>
    <!-- You can add a link to a style.css file here -->
</head>
<body>
    <div class="chat-container">
        <div id="chat-box"></div>
        <div class="input-area">
            <input type="text" id="text-input" placeholder="Talk to the AI..." disabled>
            <button id="send-btn" disabled>Send</button>
            <button id="voice-btn" disabled>🎤</button>
        </div>
        <button id="connect-btn">Connect</button>
    </div>
    <script type="module" src="script.js"></script>
</body>
</html>
```

### 2.2: The JavaScript Brains (`script.js`)
In the same folder, create a `script.js` file. This is where the web magic happens.

#### Setup and Credentials
First, we'll import Dewab, get references to our HTML elements, and define our credentials. **Remember to replace the placeholder values with your own keys!**

```javascript
import { Dewab, EVENT_TYPES } from '../dewab/index.js'; // Adjust this path if needed

const chatBox = document.getElementById('chat-box');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtn = document.getElementById('voice-btn');
const connectBtn = document.getElementById('connect-btn');

// TODO: Replace with your actual credentials
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const ARDUINO_DEVICE_NAME = 'arduino-nano-esp32_1'; // Must match the device name in Arduino's config.h
```

#### Initializing Dewab and the AI
Next, we'll create our `Dewab` instance inside a `main()` function. This is a bigger configuration than on the Arduino because it's setting up the UI and the AI as well.

```javascript
function main() {
    const dewab = new Dewab({
        geminiApiKey: GEMINI_API_KEY,
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        chatLogElement: chatBox,
        chatInputElement: textInput,
        sendChatButtonElement: sendBtn,
        voiceButtonElement: voiceBtn,
        systemInstruction: "You are a helpful assistant. You control a red and yellow LED via the 'control_led' function. Actions are 'red_on', 'red_off', 'yellow_on', 'yellow_off'. You can also use 'get_kanye_quote'.",
        tools: [ /* AI tools will go here */ ]
    });

    // ... more code to come
}

document.addEventListener('DOMContentLoaded', main);
```
We pass in our keys, bind the UI elements, and give the AI a `systemInstruction`. This is a secret prompt that tells Gemini about its role and capabilities. The most important part is the `tools` array.

#### Giving the AI "Tools"
A "tool" is a function the AI can decide to call to perform an action. We'll give it two tools. Add the following code inside the `tools` array.

```javascript
// This code goes inside the 'tools' array in the Dewab constructor
{
    type: 'function',
    name: 'get_kanye_quote',
    definition: {
        description: "Get a Kanye West quote.",
        parameters: {},
        handler: async () => {
            const response = await fetch('https://api.kanye.rest/');
            const data = await response.json();
            // We return the fetched quote, which will be displayed in the chat.
            return data.quote; 
        }
    }
}, {
    type: 'function',
    name: 'control_led',
    definition: {
        description: "Turns a red or yellow LED on or off.",
        parameters: {
            type: "object",
            properties: { action: { type: "string", description: "The action for the LED.", enum: ["red_on", "red_off", "yellow_on", "yellow_off"] } },
            required: ["action"],
        },
        handler: async (args) => {
            const action = args.action || args.properties; // Gemini argument workaround
            const commandPayload = {};

            switch (action) {
                case 'red_on':      commandPayload.led_red = true; break;
                case 'red_off':     commandPayload.led_red = false; break;
                case 'yellow_on':   commandPayload.led_yellow = true; break;
                case 'yellow_off':  commandPayload.led_yellow = false; break;
                default: return { error: `Invalid action: ${action}` };
            }

            // This is the magic link! We send the command to our Arduino.
            await dewab.device(ARDUINO_DEVICE_NAME).sendCommand('set_outputs', commandPayload);
            return { success: true, action: action };
        }
    }
}
```
*   `get_kanye_quote`: A simple tool that calls a public API.
*   `control_led`: This is the bridge to our hardware. When you type "turn on the red led", the AI is smart enough to know it should call this function with the action `"red_on"`. The `handler` then builds a payload and uses `dewab.device(...).sendCommand('set_outputs', ...)` to send the command to our Arduino. It's the *same command name* we registered in our Arduino sketch!

#### Handling Events
Finally, we need to handle button clicks and events from Dewab. Add this code inside `main()`, after the `dewab` constructor.

```javascript
    // Inside main()
    updateConnectButtonUI(false); // Set initial UI state

    // --- UI and Device Logic ---
    connectBtn.addEventListener('click', async () => {
        if (dewab.isConnected()) {
            await dewab.disconnect();
        } else {
            await dewab.connect();
            // Start listening for updates from the Arduino device after connecting
            dewab.device(ARDUINO_DEVICE_NAME).on('update', () => {}); // Listener needed to establish subscription
        }
    });

    dewab.eventBus.on(EVENT_TYPES.GEMINI_STATUS_UPDATE, (status) => {
        if (status.connected !== undefined) {
            updateConnectButtonUI(status.connected);
        }
    });

    // This is how we react to the physical button press!
    dewab.eventBus.on(EVENT_TYPES.DEVICE_STATE_UPDATED, async (data) => {
        // When the Arduino button is pressed, its state update triggers this event.
        if (data.device === ARDUINO_DEVICE_NAME && data.state?.inputs?.button_d2 === true) {
            addMessageToChat('Arduino button pressed! Requesting a Kanye quote...', 'system');
            await dewab.sendTextMessageToGemini('give me a quote from kanye west');
        }
    });
```
When our Arduino calls `broadcastCurrentState()`, the web app receives it and fires a `DEVICE_STATE_UPDATED` event. Our listener picks this up, checks if it was the button, and tells Gemini to get a quote. This is the reverse flow: hardware triggering a software action.

We also need some helper functions. Add these outside the `main` function.

```javascript
/** Helper Functions **/

function updateConnectButtonUI(isConnected) {
    textInput.disabled = !isConnected;
    sendBtn.disabled = !isConnected;
    voiceBtn.disabled = !isConnected;
    if (isConnected) {
        connectBtn.textContent = 'Disconnect';
        connectBtn.classList.add('connected');
    } else {
        connectBtn.textContent = 'Connect';
        connectBtn.classList.remove('connected');
    }
}

function addMessageToChat(message, type) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', `${type}-message`);
    messageElement.textContent = message;
    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight;
}
```

### 2.3: The Complete JavaScript File
Here is the final `script.js` for you to copy and paste.

```javascript
import { Dewab, EVENT_TYPES } from '../dewab/index.js';

const chatBox = document.getElementById('chat-box');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtn = document.getElementById('voice-btn');
const connectBtn = document.getElementById('connect-btn');

// TODO: Replace with your actual credentials
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const ARDUINO_DEVICE_NAME = 'arduino-nano-esp32_1'; // Must match the device name in Arduino sketch

function main() {
    const dewab = new Dewab({
        geminiApiKey: GEMINI_API_KEY,
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        chatLogElement: chatBox,
        chatInputElement: textInput,
        sendChatButtonElement: sendBtn,
        voiceButtonElement: voiceBtn,
        systemInstruction: "You are a helpful assistant. You control a red and yellow LED via the 'control_led' function. Actions are 'red_on', 'red_off', 'yellow_on', 'yellow_off'. You can also use 'get_kanye_quote'.",
        tools: [{
            type: 'function',
            name: 'get_kanye_quote',
            definition: {
                description: "Get a Kanye West quote.",
                parameters: {},
                handler: async () => {
                    const response = await fetch('https://api.kanye.rest/');
                    const data = await response.json();
                    // We return the fetched quote, which will be displayed in the chat.
                    return data.quote; 
                }
            }
        }, {
            type: 'function',
            name: 'control_led',
            definition: {
                description: "Turns a red or yellow LED on or off.",
                parameters: {
                    type: "object",
                    properties: { action: { type: "string", description: "The action for the LED.", enum: ["red_on", "red_off", "yellow_on", "yellow_off"] } },
                    required: ["action"],
                },
                handler: async (args) => {
                    const action = args.action || args.properties; // Gemini argument workaround
                    const commandPayload = {};

                    switch (action) {
                        case 'red_on':      commandPayload.led_red = true; break;
                        case 'red_off':     commandPayload.led_red = false; break;
                        case 'yellow_on':   commandPayload.led_yellow = true; break;
                        case 'yellow_off':  commandPayload.led_yellow = false; break;
                        default: return { error: `Invalid action: ${action}` };
                    }

                    // This is where we send the command to our Arduino!
                    await dewab.device(ARDUINO_DEVICE_NAME).sendCommand('set_outputs', commandPayload);
                    return { success: true, action: action };
                }
            }
        }],
    });
    
    updateConnectButtonUI(false);

    // --- UI and Device Logic ---
    connectBtn.addEventListener('click', async () => {
        if (dewab.isConnected()) {
            await dewab.disconnect();
        } else {
            await dewab.connect();
            // Start listening for updates from the Arduino device after connecting
            dewab.device(ARDUINO_DEVICE_NAME).on('update', () => {}); // Listener needed to establish subscription
        }
    });

    dewab.eventBus.on(EVENT_TYPES.GEMINI_STATUS_UPDATE, (status) => {
        if (status.connected !== undefined) {
            updateConnectButtonUI(status.connected);
        }
    });

    dewab.eventBus.on(EVENT_TYPES.DEVICE_STATE_UPDATED, async (data) => {
        // When the Arduino button is pressed, its state update triggers this event.
        if (data.device === ARDUINO_DEVICE_NAME && data.state?.inputs?.button_d2 === true) {
            addMessageToChat('Arduino button pressed! Requesting a Kanye quote...', 'system');
            await dewab.sendTextMessageToGemini('give me a quote from kanye west');
        }
    });
}

/** Helper Functions **/

function updateConnectButtonUI(isConnected) {
    textInput.disabled = !isConnected;
    sendBtn.disabled = !isConnected;
    voiceBtn.disabled = !isConnected;
    if (isConnected) {
        connectBtn.textContent = 'Disconnect';
        connectBtn.classList.add('connected');
    } else {
        connectBtn.textContent = 'Connect';
        connectBtn.classList.remove('connected');
    }
}

function addMessageToChat(message, type) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', `${type}-message`);
    messageElement.textContent = message;
    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// Start the application
document.addEventListener('DOMContentLoaded', main);
```

## Part 3: The Grand Unveiling — How It All Connects

You've now seen both sides of the application. Let's trace the data flow to see how Dewab connects everything seamlessly.

**Flow 1: User asks to turn on an LED.**
1.  **User:** Types "turn on the red led" into the web UI.
2.  **Dewab.js:** Sends this text to the Gemini API.
3.  **Gemini AI:** Processes the language, understands the intent, and sees that its `control_led` tool is the right one for the job. It decides to call the tool with the argument `{ action: 'red_on' }`.
4.  **Dewab.js:** Executes the `control_led` tool's `handler` function.
5.  **Handler:** The function runs `dewab.device('...').sendCommand('set_outputs', { led_red: true })`.
6.  **Supabase:** The command is sent as a message through a Supabase Realtime channel.
7.  **Dewab.h (Arduino):** Is constantly listening to that channel, receives the message.
8.  **Arduino:** The `registerCommand` callback for `set_outputs` is executed. It flips the `digitalWrite` for the red LED pin.
9.  **Result:** The red LED on your desk lights up. Magic.

**Flow 2: User presses the physical button.**
1.  **User:** Pushes the button on the breadboard.
2.  **Arduino:** The `readAndProcessInputs()` function detects the pin state change.
3.  **Dewab.h (Arduino):** The function calls `dewab.broadcastCurrentState()`.
4.  **Supabase:** The new device state (`{ "inputs": { "button_d2": true } }`) is published to the Supabase channel.
5.  **Dewab.js:** Is listening and receives the state update. It fires the `DEVICE_STATE_UPDATED` event.
6.  **Event Listener:** Our `on()` callback for the event is executed.
7.  **Dewab.js:** It sees the button was pressed and calls `dewab.sendTextMessageToGemini('give me a quote from kanye west')`.
8.  **Gemini AI:** Gets the request, calls its `get_kanye_quote` tool, gets the quote from the API, and sends it back.
9.  **Result:** A fresh Kanye quote appears in the chat box on the web page.

## Conclusion

And there you have it! A fully-featured, full-stack AIoT application. We've built a system where natural language commands control hardware, and physical hardware can trigger cloud-based AI actions.

What's remarkable is how little code we had to write to manage the complex communication between the browser, the AI, and the microcontroller. The `Dewab` library handles the heavy lifting of device presence, state synchronization, and command dispatching over Supabase, letting you focus on what makes your application unique.

This is just the beginning. You can expand this with more sensors, more actuators, and more complex AI tools. Happy building! 