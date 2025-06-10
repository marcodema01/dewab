import { Dewab, EVENT_TYPES } from '../dewab/index.js';

const chatBox = document.getElementById('chat-box');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtn = document.getElementById('voice-btn');
const connectBtn = document.getElementById('connect-btn');

// TODO: Replace with your actual Gemini API key
const GEMINI_API_KEY = '';

/**
 * Main application entry point.
 * Initializes the Dewab library and sets up the application.
 */
async function main() {
    // Check if the API key has been replaced
    if (GEMINI_API_KEY.startsWith('REPLACE_')) {
        const errorMsg = "Please replace 'REPLACE_WITH_YOUR_GEMINI_API_KEY' in demo/script.js with your actual Gemini API key.";
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'system-message');
        messageElement.style.backgroundColor = '#ffdddd';
        messageElement.style.color = '#d8000c';
        messageElement.textContent = errorMsg;
        chatBox.appendChild(messageElement);
        console.error(errorMsg);
        return;
    }

    // --- DEWAB INITIALIZATION ---
    let dewab;

    try {
        console.log('[Demo] Initializing Dewab...');
        
        // Initialize Dewab but do not connect automatically
        dewab = new Dewab({
            geminiApiKey: GEMINI_API_KEY,
            chatLogElement: chatBox,
            chatInputElement: textInput,
            sendChatButtonElement: sendBtn,
            voiceButtonElement: voiceBtn,
            systemInstruction: "You are a helpful and witty assistant. You have access to a tool that can provide a random quote. When a user asks for a quote, use the 'get_random_quote' tool. Keep your responses conversational and natural.",
            tools: [{
                type: 'function',
                name: 'get_random_quote',
                definition: {
                    description: "Gets a random quote from the Kanye West quote API.",
                    parameters: {},
                    handler: async () => {
                        try {
                            const response = await fetch('https://api.kanye.rest/');
                            const data = await response.json();
                            return data.quote;
                        } catch (error) {
                            return { error: `Failed to fetch quote: ${error.message}` };
                        }
                    }
                }
            }]
        });

        // Expose the Dewab instance globally for easy debugging from the console
        window.dewab = dewab;
        
        console.log('[Demo] Dewab initialized. Click "Connect" to start.');
        updateConnectButton(false);

    } catch (error) {
        console.error('[Demo] Failed to initialize Dewab:', error);
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'system-message');
        messageElement.textContent = `Initialization failed: ${error.message}`;
        chatBox.appendChild(messageElement);
        connectBtn.textContent = 'Error';
        connectBtn.disabled = true;
        return;
    }

    // --- UI CONTROL LOGIC ---

    function updateConnectButton(isConnected) {
        if (isConnected) {
            connectBtn.textContent = 'Disconnect';
            connectBtn.classList.add('connected');
            textInput.disabled = false;
            sendBtn.disabled = false;
            voiceBtn.disabled = false;
        } else {
            connectBtn.textContent = 'Connect';
            connectBtn.classList.remove('connected');
            textInput.disabled = true;
            sendBtn.disabled = true;
            voiceBtn.disabled = true;
        }
    }

    connectBtn.addEventListener('click', async () => {
        if (dewab.isConnected()) {
            console.log('[Demo] Disconnecting...');
            await dewab.disconnect();
        } else {
            console.log('[Demo] Connecting...');
            try {
                await dewab.connect();
            } catch (error) {
                console.error('[Demo] Connection failed:', error);
            }
        }
    });
    
    // Listen for status updates from Dewab to keep the UI in sync
    dewab.eventBus.on(EVENT_TYPES.GEMINI_STATUS_UPDATE, (status) => {
        console.log('[Demo] Received GEMINI_STATUS_UPDATE:', status);
        if (status.connected !== undefined) {
            updateConnectButton(status.connected);
        }
    });
    
    // Debug: Listen to all events
    const allEventTypes = Object.values(EVENT_TYPES);
    allEventTypes.forEach(eventType => {
        dewab.eventBus.on(eventType, (data) => {
            console.log(`[Demo] Event: ${eventType}`, data);
        });
    });
}

// Start the application once the DOM is fully loaded
document.addEventListener('DOMContentLoaded', main);

