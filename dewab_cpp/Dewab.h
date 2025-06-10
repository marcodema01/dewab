#ifndef DEWAB_H
#define DEWAB_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <functional>
#include <map>

// =================================================================
// WifiManager: Manages WiFi connection and reconnection.
// (Previously in WifiManager.h)
// =================================================================
class WifiManager {
public:
    // Constructor for WifiManager
    WifiManager(const char* ssid, const char* password);
    
    // Connects to the WiFi network.
    void connect();
    
    // Checks if the device is connected to WiFi.
    bool isConnected();
    
    // Handles periodic tasks like reconnection. Should be called in loop().
    void loop();

private:
    const char* _ssid;
    const char* _password;
    unsigned long _lastReconnectAttempt = 0;
    const unsigned long _reconnectInterval = 30000; // 30 seconds
};


// =================================================================
// SupabaseRealtimeClient: Handles WebSocket communication with Supabase.
// (Previously in SupabaseRealtimeClient.h)
// =================================================================
// Callback function types for Supabase events
typedef std::function<void()> ConnectedCallback;
typedef std::function<void()> DisconnectedCallback;
typedef std::function<void(String)> ErrorCallback;
typedef std::function<void(const String&, const String&, const JsonObjectConst&)> BroadcastCallback;
typedef std::function<void(const String& topic, const String& joinRef)> ChannelJoinedCallback;

class SupabaseRealtimeClient {
public:
    SupabaseRealtimeClient(const char* projectRef, const char* apiKey);
    ~SupabaseRealtimeClient();

    void onConnected(ConnectedCallback callback);
    void onDisconnected(DisconnectedCallback callback);
    void onError(ErrorCallback callback);
    void onBroadcast(BroadcastCallback callback);
    void onChannelJoined(ChannelJoinedCallback callback);

    void connect();
    void loop();
    bool isConnected();

    void joinChannel(const String& topic);
    bool broadcast(const String& topic, const String& event, const JsonDocument& payload);

private:
    void buildWebSocketUrl();
    void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);
    String getNextMessageRef();
    void sendHeartbeat();
    void _joinChannel(const char* channelTopic);

    String _projectRef;
    String _apiKey;
    String _wsHost;
    String _wsPath;
    const uint16_t _wsPort = 443;
    WebSocketsClient webSocket;

    bool _connected = false;
    unsigned long _lastHeartbeatSent = 0;
    const unsigned long _heartbeatInterval = 25000; // 25 seconds
    unsigned int _messageRefCounter = 1;

    ConnectedCallback _connectedCallback = nullptr;
    DisconnectedCallback _disconnectedCallback = nullptr;
    ErrorCallback _errorCallback = nullptr;
    BroadcastCallback _broadcastCallback = nullptr;
    ChannelJoinedCallback _channelJoinedCallback = nullptr;

    std::map<String, String> _topicJoinRefs;
};


// =================================================================
// Dewab: The main library interface for students.
// =================================================================
typedef std::function<void(JsonDocument& docToPopulate)> StateProviderCallback;
typedef std::function<bool(const JsonObjectConst& payload, JsonDocument& customReplyData)> SpecificCommandHandler;

class Dewab {
public:
    // Constructor now takes device name and all necessary credentials
    Dewab(const char* deviceName, 
          const char* wifiSsid, const char* wifiPassword,
          const char* supabaseRef, const char* supabaseKey);

    void begin(); // Will handle WiFi and Supabase connection
    void loop();  // Will handle internal client loops

    // Method to register callbacks from the main sketch
    void onStateUpdateRequest(StateProviderCallback callback);
    // New method to register individual command handlers
    void registerCommand(const String& commandType, SpecificCommandHandler handler);

    // Call this from the main sketch when you want to send the current state
    void broadcastCurrentState(const char* reason);

    // These remain for internal use by the SupabaseClient instance owned by Dewab
    void handleSupabaseConnected();
    void handleBroadcastCommand(const String& topic, const String& event, const JsonObjectConst& payload);
    void handleSupabaseDisconnected();
    void handleSupabaseError(String errorMsg);
    void handleSupabaseChannelJoined(const String& topic, const String& joinRef);

    // Helper methods for students to build the state JSON document
    void stateAddInt(JsonDocument& doc, const char* category, const char* name, int value);
    void stateAddBool(JsonDocument& doc, const char* category, const char* name, bool value);
    void stateAddString(JsonDocument& doc, const char* category, const char* name, const char* value);
    void stateAddString(JsonDocument& doc, const char* category, const char* name, const String& value);
    void stateAddFloat(JsonDocument& doc, const char* category, const char* name, float value, int decimals = 2);
    void stateAddAnalogPin(JsonDocument& doc, const char* category, const char* name, int pin);
    void stateAddDigitalPin(JsonDocument& doc, const char* category, const char* name, int pin, bool activeLow = false);

private:
    const char* _deviceName;
    
    // Dewab now owns these
    WifiManager _wifiManager;
    SupabaseRealtimeClient _supabaseClient;

    StateProviderCallback _stateProvider = nullptr;
    // Store registered command handlers
    std::map<String, SpecificCommandHandler> _registeredCommands;
};

#endif // DEWAB_H 