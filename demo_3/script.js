import { Dewab, EVENT_TYPES } from '../dewab/index.js';

const chatBox = document.getElementById('chat-box');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtn = document.getElementById('voice-btn');
const connectBtn = document.getElementById('connect-btn');

// TODO: Replace with your actual Gemini API key
const GEMINI_API_KEY = '';
// TODO: Replace with your Supabase credentials
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';

const ARDUINO_DEVICE_NAME = 'arduino-nano-esp32_1';

/**
 * Main application entry point.
 */
function main() {
    // --- Dewab Initialization ---
    const dewab = new Dewab({
        geminiApiKey: GEMINI_API_KEY,
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        chatLogElement: chatBox,
        chatInputElement: textInput,
        sendChatButtonElement: sendBtn,
        voiceButtonElement: voiceBtn,
        systemInstruction: "You are a helpful assistant. You control a red and yellow LED via the 'control_led' function. Actions are 'red_on', 'red_off', 'yellow_on', 'yellow_off'. You can also use 'get_random_quote'.",
        tools: [{
            type: 'function',
            name: 'get_kanye_quote',
            definition: {
                description: "Get a Kanye West quote.",
                parameters: {},
                handler: async () => {
                    const response = await fetch('https://api.kanye.rest/');
                    const data = await response.json();
                    return 
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

                    await dewab.device(ARDUINO_DEVICE_NAME).sendCommand('set_outputs', commandPayload);
                    return 
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

