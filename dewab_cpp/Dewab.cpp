#include <Arduino.h>
#include <ArduinoJson.h>
#include "Dewab.h"

// =================================================================
// WifiManager Implementation
// (Previously in WifiManager.cpp)
// =================================================================
WifiManager::WifiManager(const char* ssid, const char* password)
    : _ssid(ssid), _password(password) {}

void WifiManager::connect() {
    Serial.printf("Connecting to WiFi: %s", _ssid);

    WiFi.begin(_ssid, _password);

    unsigned long startTime = millis();
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        if (millis() - startTime > 10000) { // 10 second timeout for WiFi
            Serial.println(" - FAILED (timeout after 10s)");
            return;
        }
    }
    Serial.printf(" - CONNECTED (IP: %s)\n", WiFi.localIP().toString().c_str());
}

bool WifiManager::isConnected() {
    return (WiFi.status() == WL_CONNECTED);
}

void WifiManager::loop() {
    if (!isConnected()) {
        unsigned long currentTime = millis();
        if (currentTime - _lastReconnectAttempt > _reconnectInterval) {
            Serial.printf("WiFi disconnected, reconnecting to %s...", _ssid);
            connect();
            _lastReconnectAttempt = currentTime;
        }
    }
}


// =================================================================
// SupabaseRealtimeClient Implementation
// (Previously in SupabaseRealtimeClient.cpp)
// =================================================================
SupabaseRealtimeClient::SupabaseRealtimeClient(const char* projectRef, const char* apiKey)
    : _projectRef(projectRef), _apiKey(apiKey) {
    buildWebSocketUrl();
}

SupabaseRealtimeClient::~SupabaseRealtimeClient() {
    if (_connected) {
        webSocket.disconnect();
    }
}

void SupabaseRealtimeClient::buildWebSocketUrl() {
    _wsHost = String(_projectRef) + ".supabase.co";
    _wsPath = "/realtime/v1/websocket?apikey=" + String(_apiKey) + "&vsn=1.0.0";
    Serial.printf("WebSocket URL built: %s%s\n", _wsHost.c_str(), _wsPath.c_str());
}

void SupabaseRealtimeClient::connect() {
    if (_connected) {
        Serial.println("WebSocket already connected");
        if (_errorCallback) _errorCallback("Already connected or connecting.");
        return;
    }
    webSocket.onEvent(std::bind(&SupabaseRealtimeClient::webSocketEvent, this, std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
    
    Serial.printf("Connecting to WebSocket: %s%s\n", _wsHost.c_str(), _wsPath.c_str());
    webSocket.beginSSL(_wsHost.c_str(), _wsPort, _wsPath.c_str());
}

void SupabaseRealtimeClient::loop() {
    webSocket.loop();
    if (_connected) {
        unsigned long currentTime = millis();
        if (currentTime - _lastHeartbeatSent >= _heartbeatInterval) {
            sendHeartbeat();
        }
    }
}

bool SupabaseRealtimeClient::isConnected() {
    return _connected;
}

void SupabaseRealtimeClient::onConnected(ConnectedCallback callback) {
    _connectedCallback = callback;
}

void SupabaseRealtimeClient::onDisconnected(DisconnectedCallback callback) {
    _disconnectedCallback = callback;
}

void SupabaseRealtimeClient::onError(ErrorCallback callback) {
    _errorCallback = callback;
}

void SupabaseRealtimeClient::onBroadcast(BroadcastCallback callback) {
    _broadcastCallback = callback;
}

void SupabaseRealtimeClient::onChannelJoined(ChannelJoinedCallback callback) {
    _channelJoinedCallback = callback;
}

String SupabaseRealtimeClient::getNextMessageRef() {
    return String(_messageRefCounter++);
}

void SupabaseRealtimeClient::sendHeartbeat() {
    if (!_connected) {
        return;
    }

    String ref = getNextMessageRef();
    
    JsonDocument doc; 
    doc["topic"] = "phoenix";
    doc["event"] = "heartbeat";
    doc["payload"].to<JsonObject>(); 
    doc["ref"] = ref;

    String msg;
    size_t written = serializeJson(doc, msg);
    if (written == 0) {
        Serial.println("Heartbeat serialization failed");
        if (_errorCallback) _errorCallback("Failed to serialize heartbeat JSON.");
        return;
    }
    Serial.printf("Heartbeat sent (ref: %s)\n", ref.c_str());
    
    if (webSocket.sendTXT(msg)) {
        _lastHeartbeatSent = millis();
    } else {
        Serial.println("Heartbeat send failed");
        if (_errorCallback) _errorCallback("WebSocket sendTXT failed for heartbeat.");
    }
}

void SupabaseRealtimeClient::joinChannel(const String& topic) {
    if (!_connected) {
        Serial.println("Cannot join channel: not connected");
        if (_errorCallback) _errorCallback("Cannot join channel: Not connected.");
        return;
    }
    Serial.printf("Joining channel: %s\n", topic.c_str());
    _joinChannel(topic.c_str());
}

void SupabaseRealtimeClient::_joinChannel(const char* channelTopic) {
    if (!_connected) {
        Serial.printf("Cannot join %s: not connected\n", channelTopic);
        return;
    }

    String ref = getNextMessageRef();
    JsonDocument doc;
    doc["topic"] = channelTopic;
    doc["event"] = "phx_join";
    doc["ref"] = ref;
    doc["join_ref"] = ref;

    JsonObject payloadObj = doc["payload"].to<JsonObject>();
    payloadObj["access_token"] = _apiKey;
        
    JsonObject config = payloadObj["config"].to<JsonObject>();
    JsonObject broadcastConf = config["broadcast"].to<JsonObject>();
    broadcastConf["self"] = false; 
    JsonObject presenceConf = config["presence"].to<JsonObject>();
    presenceConf["key"] = ""; 
    config["private"] = false;

    String msg;
    size_t written = serializeJson(doc, msg);
    if (written == 0) {
        Serial.printf("Join serialization failed for: %s\n", channelTopic);
        if (_errorCallback) _errorCallback(String("Failed to serialize join JSON for topic: ") + channelTopic);
        return;
    }
    Serial.printf("Channel join sent: %s (ref: %s)\n", channelTopic, ref.c_str());

    if (!webSocket.sendTXT(msg)) {
        Serial.printf("Join send failed for: %s\n", channelTopic);
        if (_errorCallback) _errorCallback(String("WebSocket sendTXT failed for join: ") + channelTopic);
    }
}

bool SupabaseRealtimeClient::broadcast(const String& topic, const String& event, const JsonDocument& payload) {
    if (!_connected) {
        Serial.println("Cannot broadcast: not connected");
        if (_errorCallback) _errorCallback("Cannot broadcast: Not connected.");
        return false;
    }

    auto it = _topicJoinRefs.find(topic);
    if (it == _topicJoinRefs.end()) {
        Serial.printf("Cannot broadcast: not joined to %s\n", topic.c_str());
        if (_errorCallback) _errorCallback(String("Cannot broadcast: Not joined to topic ") + topic);
        return false;
    }
    String joinRef = it->second;
    String messageRef = getNextMessageRef();

    JsonDocument doc;
    doc["topic"] = topic;
    doc["event"] = "broadcast";
    
    JsonObject nestedPayload = doc["payload"].to<JsonObject>();
    nestedPayload["type"] = "broadcast";
    nestedPayload["event"] = event;
    nestedPayload["payload"] = payload.as<JsonObjectConst>();

    doc["ref"] = messageRef;
    doc["join_ref"] = joinRef;

    String msgStr;
    size_t written = serializeJson(doc, msgStr);
    if (written == 0) {
        Serial.printf("Broadcast serialization failed for: %s\n", event.c_str());
        if (_errorCallback) _errorCallback(String("Failed to serialize broadcast JSON for event: ") + event);
        return false;
    }

    Serial.printf("Broadcasting: %s -> %s (ref: %s)\n", topic.c_str(), event.c_str(), messageRef.c_str());

    if (webSocket.sendTXT(msgStr)) {
        return true;
    } else {
        Serial.printf("Broadcast send failed for: %s\n", event.c_str());
        if (_errorCallback) _errorCallback(String("WebSocket sendTXT failed for broadcast: ") + event);
        return false;
    }
}

void SupabaseRealtimeClient::webSocketEvent(WStype_t type, uint8_t * payloadArg, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            _connected = false;
            Serial.println("WebSocket disconnected");
            if (_disconnectedCallback) _disconnectedCallback();
            break;
        case WStype_CONNECTED:
            _connected = true;
            _lastHeartbeatSent = millis(); 
            _messageRefCounter = 1; 
            Serial.printf("WebSocket connected: %s\n", (char*)payloadArg); 
            sendHeartbeat();
            
            if (_connectedCallback) {
                _connectedCallback();
            }
            break;
        case WStype_TEXT:
            Serial.printf("WebSocket received (%d bytes)\n", length);
            {
                JsonDocument doc; 
                DeserializationError error = deserializeJson(doc, payloadArg, length);

                if (error) {
                    Serial.printf("JSON parse failed: %s\n", error.c_str());
                    if (_errorCallback) _errorCallback(String("JSON Deserialization failed: ") + error.c_str());
                    return;
                }

                const char* topic = doc["topic"].as<const char*>();
                const char* event = doc["event"].as<const char*>();
                JsonObjectConst jsonPayload = doc["payload"].as<JsonObjectConst>();
                const char* msgRef = doc["ref"].as<const char*>();

                bool handled = false; 

                if (jsonPayload) { 
                    if (jsonPayload["status"].is<JsonVariant>()) {
                        if (topic && strncmp(topic, "realtime:", 9) == 0 && event && strcmp(event, "phx_reply") == 0) {
                            if (jsonPayload["status"] == "ok") {
                                if (msgRef) { 
                                    _topicJoinRefs[topic] = String(msgRef); 
                                    Serial.printf("Channel joined: %s (ref: %s)\n", topic, msgRef);
                                    if (_channelJoinedCallback) {
                                        _channelJoinedCallback(topic, String(msgRef));
                                    }
                                } else {
                                    Serial.printf("Channel joined: %s (no ref)\n", topic);
                                    if (_channelJoinedCallback) {
                                        _channelJoinedCallback(topic, "");
                                    }
                                }
                            }
                        }
                    }
                }

                if (topic && strcmp(topic, "phoenix") == 0 && event && strcmp(event, "phx_reply") == 0) {
                    if (jsonPayload && jsonPayload["status"] == "ok") {
                        Serial.println("Phoenix heartbeat OK"); 
                    } else {
                        Serial.println("Phoenix heartbeat failed");
                         if (_errorCallback) _errorCallback("Phoenix reply not OK.");
                    }
                    handled = true; 
                } else if (topic && strncmp(topic, "realtime:", 9) == 0 && event && strcmp(event, "phx_reply") == 0) {
                    if (jsonPayload && jsonPayload["status"] == "ok") {
                        if (msgRef) {
                            _topicJoinRefs[topic] = String(msgRef);
                            if (_channelJoinedCallback) {
                                _channelJoinedCallback(topic, String(msgRef));
                            }
                        }
                    } else {
                       String reason = jsonPayload["response"].is<JsonVariant>() && jsonPayload["response"]["reason"].is<JsonVariant>() ? jsonPayload["response"]["reason"].as<String>() : "unknown reason";
                       Serial.printf("Channel join failed: %s (%s)\n", topic, reason.c_str());
                       if (_errorCallback) _errorCallback(String("Join failed for ") + topic + ": " + reason);
                    }
                    handled = true; 
                }
                else if (topic && event && strcmp(event, "broadcast") == 0 && _broadcastCallback) {
                    if (jsonPayload && 
                        jsonPayload["type"].as<String>() == "broadcast" && 
                        jsonPayload["event"].is<const char*>() &&
                        jsonPayload["payload"].is<JsonObjectConst>()) {
                        
                        String userEvent = jsonPayload["event"].as<String>();
                        JsonObjectConst userPayload = jsonPayload["payload"].as<JsonObjectConst>();
                        Serial.printf("Broadcast received: %s -> %s\n", topic, userEvent.c_str());
                        _broadcastCallback(topic, userEvent, userPayload);
                    } else {
                        Serial.printf("Broadcast (raw or parse error): %s, Event: %s\n", topic, event);
                        if (jsonPayload && jsonPayload["type"].is<const char*>()) {
                             Serial.printf("  -> Received type: %s\n", jsonPayload["type"].as<const char*>());
                        }
                        _broadcastCallback(topic, event, jsonPayload);
                    }
                    handled = true;
                }

                if (!handled) { 
                    Serial.printf("Unhandled message: %s/%s\n", topic ? topic : "null", event ? event : "null");
                }
            }
            break;
        case WStype_BIN:
            Serial.println("WebSocket received binary data");
            break;
        case WStype_ERROR:
            Serial.printf("WebSocket error: %s\n", (char*)payloadArg);
             if (_errorCallback) {
                _errorCallback(String("WebSocket Error: ") + (char*)payloadArg);
            }
            break;
        case WStype_PONG:
            Serial.println("WebSocket PONG received");
            break;
        case WStype_PING:
            Serial.println("WebSocket PING received");
            break;
        case WStype_FRAGMENT_TEXT_START:
        case WStype_FRAGMENT_BIN_START:
        case WStype_FRAGMENT:
        case WStype_FRAGMENT_FIN:
            break;
        default:
            break;
    }
}

// =================================================================
// Dewab Implementation
// =================================================================

// Updated Constructor
Dewab::Dewab(const char* deviceName, 
             const char* wifiSsid, const char* wifiPassword,
             const char* supabaseRef, const char* supabaseKey)
    : _deviceName(deviceName),
      _wifiManager(wifiSsid, wifiPassword), // Initialize WifiManager
      _supabaseClient(supabaseRef, supabaseKey) // Initialize SupabaseRealtimeClient
{
}

void Dewab::begin() {
    Serial.println("Dewab: Initializing...");
    Serial.println("Dewab: Connecting to WiFi...");
    _wifiManager.connect();

    if (_wifiManager.isConnected()) {
        Serial.println("Dewab: WiFi connected. Setting up Supabase client callbacks...");
        
        // Set up Supabase client to call Dewab's own handlers
        // Using [this] to capture the current Dewab instance for the lambda
        _supabaseClient.onConnected([this](){ this->handleSupabaseConnected(); });
        _supabaseClient.onDisconnected([this](){ this->handleSupabaseDisconnected(); });
        _supabaseClient.onError([this](String err){ this->handleSupabaseError(err); });
        _supabaseClient.onBroadcast([this](const String& t, const String& e, const JsonObjectConst& p){
            this->handleBroadcastCommand(t, e, p);
        });
        _supabaseClient.onChannelJoined([this](const String& topic, const String& joinRef){
            this->handleSupabaseChannelJoined(topic, joinRef);
        });
        
        Serial.println("Dewab: Connecting to Supabase...");
        _supabaseClient.connect();
    } else {
        Serial.println("Dewab: WiFi connection failed. Dewab cannot operate fully.");
    }
}

void Dewab::loop() {
    _wifiManager.loop(); // Handle WiFi connection maintenance
    if (_wifiManager.isConnected()) {
        _supabaseClient.loop(); // Process Supabase messages
    }
    // Specific periodic Dewab tasks could be added here if necessary
}

void Dewab::onStateUpdateRequest(StateProviderCallback callback) {
    _stateProvider = callback;
}

// New method to register a specific command handler
void Dewab::registerCommand(const String& commandType, SpecificCommandHandler handler) {
    if (commandType.isEmpty() || !handler) {
        Serial.printf("Dewab: Invalid attempt to register command: type '%s', handler is %s\n",
                      commandType.c_str(), handler ? "valid" : "null");
        return;
    }
    _registeredCommands[commandType] = handler;
    Serial.printf("Dewab: Command '%s' registered.\n", commandType.c_str());
}

void Dewab::handleSupabaseConnected() {
    Serial.printf("Dewab: Supabase connected - Device: %s\n", _deviceName);
    String deviceChannel = "realtime:arduino-commands"; 
    _supabaseClient.joinChannel(deviceChannel);
    // Initial state broadcast is now handled by handleSupabaseChannelJoined
}

void Dewab::handleSupabaseChannelJoined(const String& topic, const String& joinRef) {
    Serial.printf("Dewab: Supabase channel joined: %s (ref: %s)\n", topic.c_str(), joinRef.c_str());
    String expectedDeviceChannel = "realtime:arduino-commands";
    if (topic == expectedDeviceChannel) {
        if (_stateProvider) {
            broadcastCurrentState("dewab_channel_joined");
        }
    }
}

void Dewab::handleBroadcastCommand(const String& topic, const String& event, const JsonObjectConst& payload) {
    String expectedDeviceChannel = "realtime:arduino-commands";
    if (topic != expectedDeviceChannel) {
        Serial.printf("Dewab: Broadcast ignored: wrong channel (%s)\n", topic.c_str());
        return;
    }

    String actualCommandType = event;
    JsonObjectConst actualPayload = payload;

    // Check if it's a nested broadcast payload (like those from supabase-js v2)
    if (payload && payload["type"] == "broadcast" && 
        payload["event"].is<JsonVariant>() && payload["payload"].is<JsonVariant>()) {
        actualCommandType = payload["event"].as<String>();
        actualPayload = payload["payload"].as<JsonObjectConst>(); // Get the innermost payload
        Serial.printf("Dewab: Detected nested broadcast. Actual command: %s\n", actualCommandType.c_str());
    }

    Serial.printf("Dewab: Command received: %s on topic %s\n", actualCommandType.c_str(), topic.c_str());

    // Filter by target_device_name if present in the actual payload
    if (actualPayload && actualPayload["target_device_name"].is<const char*>()) {
        const char* targetDevice = actualPayload["target_device_name"].as<const char*>();
        if (strcmp(targetDevice, _deviceName) != 0) {
            Serial.printf("Dewab: Command '%s' ignored. Target device '%s' does not match '%s'.\n", actualCommandType.c_str(), targetDevice, _deviceName);
            return; 
        }
    } else {
        Serial.printf("Dewab: Command '%s' does not have target_device_name or it's invalid. Processing anyway (for backward compatibility or general commands).\n", actualCommandType.c_str());
    }

    String replyEvent = "";
    JsonDocument replyPayloadDoc; 
    JsonObject replyData = replyPayloadDoc.to<JsonObject>();

    auto it = _registeredCommands.find(actualCommandType);
    if (it != _registeredCommands.end()) {
        JsonDocument customHandlerDataDoc; 
        bool success = it->second(actualPayload, customHandlerDataDoc); 

        replyData["original_command"] = actualCommandType;
        if (!customHandlerDataDoc.isNull()) {
            for (JsonPairConst kvp : customHandlerDataDoc.as<JsonObjectConst>()) {
                replyData[kvp.key()] = kvp.value();
            }
        }

        if (success) {
            replyEvent = actualCommandType + "_ACK";
            replyData["status"] = "success";
        } else {
            replyEvent = actualCommandType + "_ERROR";
            replyData["status"] = "error";
            if (!replyData["message"].is<JsonVariant>()) { 
                replyData["message"] = "Command execution failed on device.";
            }
        }
    } else {
        Serial.printf("Dewab: No specific handler for command: %s. Sending default error reply.\n", actualCommandType.c_str());
        replyEvent = actualCommandType + "_ERROR"; 
        replyData["status"] = "error";
        replyData["message"] = "Unknown command type or no handler registered on device.";
        replyData["original_command"] = actualCommandType;
    }

    if (!replyEvent.isEmpty()) {
        // The reply should also go to the "realtime:arduino-commands" topic
        bool broadcastSuccess = _supabaseClient.broadcast(topic, replyEvent, replyPayloadDoc);
        if (broadcastSuccess) {
            Serial.printf("Dewab: Replied with event '%s' to command '%s'\n", replyEvent.c_str(), actualCommandType.c_str());
        } else {
            Serial.printf("Dewab: Failed to send reply event '%s' for command '%s'\n", replyEvent.c_str(), actualCommandType.c_str());
        }
    } else {
        Serial.printf("Dewab: No reply event generated for command: %s\n", actualCommandType.c_str());
    }
}

void Dewab::handleSupabaseDisconnected() {
    Serial.println("Dewab: Supabase disconnected");
}

void Dewab::handleSupabaseError(String errorMsg) {
    Serial.printf("Dewab: Supabase error: %s\n", errorMsg.c_str());
}

void Dewab::broadcastCurrentState(const char* reason) {
    if (!_supabaseClient.isConnected()) {
        Serial.printf("Dewab: Cannot send state (%s): Supabase not connected\n", reason);
        return;
    }

    if (!_stateProvider) {
        Serial.printf("Dewab: Cannot send state (%s): No state provider registered\n", reason);
        return;
    }

    JsonDocument stateDoc; 
    _stateProvider(stateDoc); 

    if (!stateDoc["device_name"].is<JsonVariant>()) {
         stateDoc["device_name"] = _deviceName;
    }
    if (!stateDoc["reason"].is<JsonVariant>()) {
        stateDoc["reason"] = reason;
    }
   
    Serial.printf("Dewab: Broadcasting state update (%s)\n", reason);

    String broadcastTopic = "realtime:arduino-commands"; 
    String broadcastEvent = "ARDUINO_STATE_UPDATE";   

    bool success = _supabaseClient.broadcast(broadcastTopic, broadcastEvent, stateDoc);
    if (!success) {
        Serial.println("Dewab: State broadcast failed");
    }
}

// --- State Construction Helper Implementations ---

void Dewab::stateAddInt(JsonDocument& doc, const char* category, const char* name, int value) {
    JsonObject cat = doc[category].is<JsonObject>() ? doc[category].as<JsonObject>() : doc[category].to<JsonObject>();
    cat[name] = value;
}

void Dewab::stateAddBool(JsonDocument& doc, const char* category, const char* name, bool value) {
    JsonObject cat = doc[category].is<JsonObject>() ? doc[category].as<JsonObject>() : doc[category].to<JsonObject>();
    cat[name] = value;
}

void Dewab::stateAddString(JsonDocument& doc, const char* category, const char* name, const char* value) {
    JsonObject cat = doc[category].is<JsonObject>() ? doc[category].as<JsonObject>() : doc[category].to<JsonObject>();
    cat[name] = value;
}

void Dewab::stateAddString(JsonDocument& doc, const char* category, const char* name, const String& value) {
    JsonObject cat = doc[category].is<JsonObject>() ? doc[category].as<JsonObject>() : doc[category].to<JsonObject>();
    cat[name] = value;
}

void Dewab::stateAddFloat(JsonDocument& doc, const char* category, const char* name, float value, int decimals) {
    JsonObject cat = doc[category].is<JsonObject>() ? doc[category].as<JsonObject>() : doc[category].to<JsonObject>();
    cat[name] = serialized(String(value, decimals));
}

void Dewab::stateAddAnalogPin(JsonDocument& doc, const char* category, const char* name, int pin) {
    JsonObject cat = doc[category].is<JsonObject>() ? doc[category].as<JsonObject>() : doc[category].to<JsonObject>();
    cat[name] = analogRead(pin);
}

void Dewab::stateAddDigitalPin(JsonDocument& doc, const char* category, const char* name, int pin, bool activeLow) {
    JsonObject cat = doc[category].is<JsonObject>() ? doc[category].as<JsonObject>() : doc[category].to<JsonObject>();
    bool pinState = digitalRead(pin);
    cat[name] = activeLow ? !pinState : pinState;
} 