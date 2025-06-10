# Dewab.js Library

Dewab.js is a JavaScript library for connecting and managing communication between web applications, Google's Gemini API, and IoT devices (like Arduino) via Supabase.

## Key Features

-   **Unified API**: Simplifies interaction with Gemini and Supabase.
-   **Tool-Use**: Enables Gemini to call custom functions (tools) in your web application.
-   **Device Control**: Send commands from your web app (or via Gemini) to your IoT devices.
-   **Real-time Updates**: Receive real-time state updates from your devices.

## Important Note on Gemini Tool Parameters

When defining tools for Gemini to use, be aware of a current issue where the API may send malformed arguments to your tool's handler function.

Instead of receiving a clean object with the expected parameters (e.g., `{ action: 'red_on' }`), you might receive the entire schema definition for those arguments.

**Example of malformed arguments (`args`):**

```javascript
{
  "properties": "red_on",
  "required": "True",
  "type": "string"
}
```

### Workaround

To handle this, your tool's handler function should be written to anticipate this and extract the intended value from the `properties` key if the expected key (`action` in this case) is not present.

Here is the recommended implementation for a tool handler:

```javascript
// ... inside your Dewab initialization ...
tools: [{
    type: 'function',
    name: 'control_led',
    definition: {
        description: "Turns an LED on or off.",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    description: "The desired action for the LED.",
                    enum: ["red_on", "red_off", "yellow_on", "yellow_off"],
                },
            },
            required: ["action"],
        },
        // IMPORTANT: Use `args` directly instead of destructuring
        handler: async (args) => {
            // Log the received arguments for debugging
            console.log('Tool handler received args:', args);

            // Workaround to extract the action value
            const action = args.action || args.properties;

            // ... rest of your handler logic ...
            switch (action) {
                case 'red_on':
                    // ...
                    break;
                case 'red_off':
                    // ...
                    break;
                // ... etc.
            }
        }
    }
}],
// ...
```

By checking for `args.action || args.properties`, you can make your tool robust enough to handle both correct and malformed argument structures from Gemini. 