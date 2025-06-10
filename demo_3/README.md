# Gemini Chat Demo

This demo showcases how to use the `dewab` library to create a chat application that interacts with Google's Gemini and controls multiple hardware components (two LEDs) connected to an Arduino, using parameterized function calls.

## How to Run

1.  **Hardware Setup:**
    - Connect a **red LED** to pin `A7` of your Arduino/ESP32 board.
    - Connect a **yellow LED** to pin `A6` of your Arduino/ESP32 board.
    - For each LED, the long leg (anode) connects to its pin, and the short leg (cathode) connects to GND, preferably through a resistor (e.g., 220-330 Ohm).

2.  **Provide API Key & Credentials:**
    - Open `demo_3/script.js` and replace the placeholder with your actual Gemini API key.
    - Make sure your Supabase credentials in the same file are also correct.
    - In the Arduino sketch directory, ensure you have a `config.h` file with your WiFi and Supabase credentials, matching the `DEVICE_NAME` used in the web app.

3.  **Upload the Arduino Sketch:**
    - Open `demo_3/supabase-communication_arduino_test/supabase-communication_arduino_test.ino` in the Arduino IDE.
    - Make sure you have the `Dewab` library installed.
    - Upload the sketch to your board.

4.  **Run the Web Server:**
    - You need a local web server to run this demo. If you have Python installed, you can easily start one.
    - Open a terminal in the root `dewab_1` directory.
    - Run the command: `python3 -m http.server 8000`
    - Open your web browser and go to `http://localhost:8000/demo_3/`

## How to Use

-   Click the **"Connect"** button to initialize the connection to all services.
-   Once connected, you can type messages or use the microphone button for voice commands.

### Example Commands

-   "Turn on the red LED."
-   "Switch off the yellow light."
-   "Turn the red LED off."
-   "Get me a random quote." 