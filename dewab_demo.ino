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