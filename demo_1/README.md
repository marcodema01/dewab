# Gemini Chat Demo

This demo showcases how to use the `dewab` library to create a chat application that interacts with Google's Gemini.

## How to Run

1.  **Provide API Key:**
    Open `demo/script.js` and replace `'YOUR_GEMINI_API_KEY'` with your actual Gemini API key.

2.  **Start a Web Server:**
    You need to serve the files from a local web server because of browser security policies (CORS) related to ES Modules.

    If you have Node.js installed, you can use the `serve` package:
    ```bash
    # From the root of the `dewab_1` repository
    npx serve
    ```
    Then open your browser to the URL provided by the server (usually `http://localhost:3000`) and navigate to the `demo` directory.

    If you have Python 3 installed, you can use its built-in HTTP server:
    ```bash
    # From the root of the `dewab_1` repository
    python3 -m http.server
    ```
    Then open your browser and go to `http://localhost:8000/demo/`.

3.  **Chat!**
    Once the page is loaded, you can start chatting with Gemini using text or voice. 