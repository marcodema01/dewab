/**
 * @file Configuration for the Gemini client, including API key, WebSocket URL, and default API parameters.
 */

import { configManager } from '../config-manager.js';

/**
 * The sample rate for the audio model in Hz.
 * @type {number}
 */
export const MODEL_SAMPLE_RATE = 24000;

/**
 * Generates the WebSocket URL for the Gemini API, incorporating the API key.
 * @returns {string} The full WebSocket URL.
 */
export const getWebsocketUrl = () => {
    const apiKey = configManager.get('geminiApiKey');
    if (!apiKey) {
        throw new Error('Gemini API key not configured. Please set it in the API Configuration section.');
    }
    return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
};

/**
 * Mapping of harm block thresholds to their API string values.
 * @type {object}
 */
const thresholds = {
    0: "BLOCK_NONE",
    1: "BLOCK_ONLY_HIGH",
    2: "BLOCK_MEDIUM_AND_ABOVE",
    3: "BLOCK_LOW_AND_ABOVE"
};

/**
 * Provides the default configuration object for initializing a Gemini API session.
 * This includes model choice, generation parameters, system instructions, safety settings, and transcription options.
 * @returns {object} The default Gemini API configuration.
 */
export const getDefaultConfig = () => ({
    model: 'models/gemini-2.0-flash-exp',
    generationConfig: {
        temperature: 1.8,  // Matched demo
        top_p: 0.95,
        top_k: 65,         // Matched demo
        responseModalities: "audio",
        speechConfig: {
            voiceConfig: { 
                prebuiltVoiceConfig: { 
                    voiceName: 'Aoede'
                }
            }
        }
    },
    systemInstruction: {
        parts: [{
            text: `You are a helpful assistant that can control IoT devices. You have access to tools to control LEDs and read sensor data from Arduino devices. 

When users ask you to control devices, use the available tools. Be conversational and helpful.

Keep your responses concise and natural. If you need to use a tool, explain what you're doing briefly.`
        }]
    },
    tools: {
        functionDeclarations: [], // Will be populated by UnifiedToolManager when tools are registered
    },
    // This next two shall stay empty, it works like this.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    safetySettings: [ // Reverted to original settings
        {
            "category": "HARM_CATEGORY_HARASSMENT",
            "threshold": thresholds[0] 
        },
        {
            "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
            "threshold": thresholds[0]
        },
        {
            "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            "threshold": thresholds[0]
        },
        {
            "category": "HARM_CATEGORY_HATE_SPEECH",
            "threshold": thresholds[0]
        },
        {
            "category": "HARM_CATEGORY_CIVIC_INTEGRITY",
            "threshold": thresholds[0]
        }
    ]
}); 