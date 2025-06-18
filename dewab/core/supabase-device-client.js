import { getSupabaseClient } from '../supabase/supabase-client.js';
import { eventBus, EVENT_TYPES } from '../event-bus.js';

const ARDUINO_COMMANDS_CHANNEL = "arduino-commands";
const ARDUINO_STATE_UPDATE_EVENT = "ARDUINO_STATE_UPDATE";

export class SupabaseDeviceClient {
    constructor(targetDeviceName) {
        this.targetDeviceName = targetDeviceName;
        this.latestDeviceState = null;
        this.channel = null;

        console.log(`SupabaseDeviceClient initialized for device: ${this.targetDeviceName}`);
    }

    /**
     * Get the Supabase client, handling initialization if needed
     * @private
     */
    _getSupabaseClient() {
        return getSupabaseClient();
    }

    // Method to send a command to the device via Supabase
    async sendCommand(commandType, payload) {
        if (!this.targetDeviceName) {
            console.error("Target device name not set. Cannot send command.");
            this._emitSystemMessage("Target device not specified.");
            return;
        }
        const fullPayload = {
            ...payload,
            target_device_name: this.targetDeviceName,
        };
        try {
            const supabaseClient = this._getSupabaseClient();
            const channel = supabaseClient.channel(ARDUINO_COMMANDS_CHANNEL, {
                config: {
                    broadcast: {
                        ack: true,
                    },
                },
            });

            await channel.send({
                type: 'broadcast',
                event: commandType,
                payload: fullPayload,
            });

            console.log(`Command '${commandType}' sent to ${this.targetDeviceName} via broadcast on '${ARDUINO_COMMANDS_CHANNEL}' with payload:`, fullPayload);
            return { status: 'success', message: 'Command sent successfully' };
        } catch (error) {
            console.error(`Error sending command '${commandType}' to ${this.targetDeviceName}:`, error);
            this._emitSystemMessage(`Error sending command: ${error.message || 'Unknown error'}`);
        }
    }

    // Method to subscribe to device updates
    subscribeToDeviceUpdates(callback) {
        if (this.channel) {
            console.warn(`[SupabaseDeviceClient] Already subscribed to channel for ${this.targetDeviceName}.`);
            return this.channel;
        }

        console.log("SupabaseDeviceClient: subscribeToDeviceUpdates method called.");
        if (!this.targetDeviceName) {
            console.error("Target device name not set. Cannot subscribe to updates.");
            this._emitSystemMessage("Target device not specified for updates.");
            return null;
        }
        const supabaseClient = this._getSupabaseClient();
        this.channel = supabaseClient.channel(ARDUINO_COMMANDS_CHANNEL);

        this.channel
            .on('broadcast', { event: '*' }, (message) => {
                // Listen for all broadcast events and filter manually.
                // The Supabase JS SDK provides the nested event name at the top level.
                console.log('[SupabaseDeviceClient] Raw broadcast received:', message);

                const eventName = message.event;
                const payload = message.payload;

                if (eventName === ARDUINO_STATE_UPDATE_EVENT && payload) {
                    if (payload.device_name === this.targetDeviceName) {
                        this.latestDeviceState = payload; // Store the latest state
                        callback(payload);
                    }
                }
            })
            .subscribe((status) => {
                console.log(`SupabaseDeviceClient: Supabase channel '${ARDUINO_COMMANDS_CHANNEL}' subscription status: ${status}`);
                if (status === 'SUBSCRIBED') {
                    console.log(`Successfully subscribed to ${ARDUINO_COMMANDS_CHANNEL} for ${ARDUINO_STATE_UPDATE_EVENT} for device ${this.targetDeviceName}`);
                } else {
                    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        console.error(`Subscription to ${ARDUINO_COMMANDS_CHANNEL} failed. Status: ${status}`);
                        this._emitSystemMessage(`Subscription to device updates failed: ${status}.`);
                    }
                }
            });

        return this.channel;
    }

    async disconnect() {
        if (this.channel) {
            console.log(`[SupabaseDeviceClient] Unsubscribing from channel for ${this.targetDeviceName}`);
            try {
                await this.channel.unsubscribe();
                console.log(`[SupabaseDeviceClient] Successfully unsubscribed for ${this.targetDeviceName}`);
            } catch (error) {
                console.error(`[SupabaseDeviceClient] Error during unsubscribe for ${this.targetDeviceName}:`, error);
            } finally {
                this.channel = null;
            }
        }
    }

    // Method to get the latest known state for the target device
    getLatestState() {
        return this.latestDeviceState;
    }

    // Method to set the target device name if it needs to be changed post-initialization
    setTargetDeviceName(deviceName) {
        this.targetDeviceName = deviceName;
        console.log(`SupabaseDeviceClient target device updated to: ${this.targetDeviceName}`);
        this._emitSystemMessage(`Now targeting device '${deviceName}'.`);
    }

    /**
     * Emits a system message via the event bus instead of directly using chat interface
     * @private
     * @param {string} message - The system message to emit
     */
    _emitSystemMessage(message) {
        eventBus.emit(EVENT_TYPES.DEVICE_ERROR, {
            device: this.targetDeviceName,
            message: message,
            timestamp: new Date().toISOString()
        });
    }
} 