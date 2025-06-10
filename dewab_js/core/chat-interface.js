// import { ChatManager } from '../../ui/chat-manager.js'; // Updated path

/**
 * @typedef {Object} ChatMessageOptions
 * @property {'start' | 'update' | 'end'} [streamState] - Indicates the state of a streaming message.
 *           'start': A new message bubble is started.
 *           'update': The content is appended to the current message bubble.
 *           'end': The current message bubble is finalized.
 * @property {boolean} [isUserTranscription] - True if the message is a user's transcribed speech.
 */

/**
 * ChatInterface provides a simplified interface for managing chat interactions within a Dewab-powered application.
 * It abstracts the underlying DOM manipulations and state management for the chat UI.
 */
export class ChatInterface {
    /**
     * Initializes the ChatInterface.
     * @param {HTMLElement} chatLogElement - The HTML element where chat messages will be displayed.
     * @param {HTMLInputElement} chatInputElement - The HTML input element for typing chat messages.
     * @param {HTMLButtonElement} sendChatButtonElement - The HTML button element for sending chat messages.
     */
    constructor(chatLogElement, chatInputElement, sendChatButtonElement) {
        if (!chatLogElement) {
            throw new Error("Chat log element is required for ChatInterface.");
        }
        this.chatLogElement = chatLogElement;
        this.chatInputElement = chatInputElement; // Can be null if no text input field is used
        this.sendChatButtonElement = sendChatButtonElement; // Can be null

        // this.chatManager = new ChatManager(this.chatLogElement);
        // Event listeners are now handled by the main Dewab class
    }

    /**
     * Adds a message to the chat log.
     * @param {string} message - The message content.
     * @param {string} [sender='System'] - The sender of the message (e.g., "User", "Gemini", "System").
     * @param {ChatMessageOptions} [options={}] - Additional options for displaying the message.
     */
    addMessage(message, sender = 'System', options = {}) {
        // this.chatManager.addMessage(message, sender, options);
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender.toLowerCase()}-message`);
        messageElement.textContent = message;
        this.chatLogElement.appendChild(messageElement);
        this.chatLogElement.scrollTop = this.chatLogElement.scrollHeight;
    }

    /**
     * Displays a message typed by the user in the chat.
     * @param {string} messageText - The text of the message.
     */
    displayUserTypedMessage(messageText) {
        this.addMessage(messageText, "User");
    }

    /**
     * Handles the start of a streaming response from Gemini.
     * @param {string} initialText - The initial part of Gemini's response.
     */
    handleGeminiResponseStart(initialText) {
        // this.chatManager.setCurrentUserTranscriptionDiv(null); // Finalize any ongoing user transcription
        this.addMessage(initialText, "Gemini", { streamState: 'start' });
    }

    /**
     * Handles a chunk of a streaming response from Gemini.
     * @param {string} textChunk - A chunk of Gemini's response.
     */
    handleGeminiResponseChunk(textChunk) {
        // this.chatManager.addMessage(textChunk, "Gemini", { streamState: 'update' });
        const messages = this.chatLogElement.getElementsByClassName('gemini-message');
        if (messages.length > 0) {
            messages[messages.length - 1].textContent += textChunk;
        }
    }

    /**
     * Handles the end of a streaming response from Gemini.
     */
    handleGeminiResponseEnd() {
        // this.chatManager.addMessage("", "Gemini", { streamState: 'end' });
         // Finalization of the message bubble can be handled here if needed
    }

    /**
     * Displays transcribed speech from the user.
     * Manages appending to an ongoing transcription.
     * @param {string} transcriptionText - The transcribed text.
     */
    handleUserTranscription(transcriptionText) {
        this.addMessage(transcriptionText, "User");
    }

    /**
     * Displays a system-level message or notification in the chat.
     * (e.g., status updates, errors, tool usage notifications)
     * @param {string} message - The system message.
     */
    displaySystemNotification(message) {
        this.addMessage(message, "System");
    }

    /**
     * Sets the current div for displaying live user transcription.
     * If a div is passed, subsequent transcription updates will go into this div.
     * If null is passed, it finalizes any current transcription div.
     * This is typically managed by the ChatManager internally but exposed if needed.
     * @param {HTMLDivElement | null} div - The div element or null.
     */
    setCurrentUserTranscriptionDiv(div) {
        // this.chatManager.setCurrentUserTranscriptionDiv(div);
         console.warn('setCurrentUserTranscriptionDiv is not implemented after ChatManager removal.');
    }

    /**
     * Clears the chat input field.
     */
    clearChatInput() {
        if (this.chatInputElement) {
            this.chatInputElement.value = '';
        }
    }

    /**
     * Gets the current value of the chat input field.
     * @returns {string | null} The text content of the chat input or null if not available.
     */
    getChatInput() {
        return this.chatInputElement ? this.chatInputElement.value : null;
    }

    /**
     * Enables or disables the chat input field and send button.
     * @param {boolean} enable - True to enable, false to disable.
     */
    setChatInputEnabled(enable) {
        if (this.chatInputElement) {
            this.chatInputElement.disabled = !enable;
        }
        if (this.sendChatButtonElement) {
            this.sendChatButtonElement.disabled = !enable;
        }
    }
} 