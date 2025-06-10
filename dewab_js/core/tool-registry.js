/**
 * ToolRegistry manages command definitions and generates Gemini tool declarations
 * It supports both device commands and custom functions
 */
export class ToolRegistry {
    constructor() {
        this.commands = new Map(); // Device commands
        this.customFunctions = new Map(); // Non-device functions
    }

    /**
     * Register a device command definition
     * @param {Object} definition - Command definition with name, description, parameters, and optional handler
     */
    registerCommand(definition) {
        if (!definition.name || !definition.description) {
            throw new Error('Command definition must have name and description');
        }
        this.commands.set(definition.name, definition);
        console.debug(`ToolRegistry: Registered device command "${definition.name}"`);
    }

    /**
     * Register a custom function definition
     * @param {Object} definition - Function definition with name, description, parameters, and handler
     */
    registerFunction(definition) {
        if (!definition.name || !definition.description || !definition.handler) {
            throw new Error('Function definition must have name, description, and handler');
        }
        this.customFunctions.set(definition.name, definition);
        console.debug(`ToolRegistry: Registered custom function "${definition.name}"`);
    }

    /**
     * Get all Gemini tool declarations for registered commands and functions
     * @returns {Array} Array of Gemini tool declarations
     */
    getGeminiToolDeclarations() {
        const declarations = [];
        
        // Convert device commands to Gemini tools
        for (const [name, def] of this.commands) {
            const declaration = {
                name: def.name.toLowerCase().replace(/_/g, '_'), // Keep underscores for Gemini
                description: def.description,
                parameters: {
                    type: "OBJECT",
                    properties: {
                        device_name: {
                            type: "STRING",
                            description: "Name of the target device (e.g., 'arduino-nano-esp32_1')"
                        },
                        ...this._convertParameters(def.parameters || {})
                    },
                    required: ["device_name", ...Object.keys(def.parameters || {})]
                }
            };
            declarations.push(declaration);
        }

        // Convert custom functions to Gemini tools
        for (const [name, def] of this.customFunctions) {
            const declaration = {
                name: def.name.toLowerCase().replace(/_/g, '_'),
                description: def.description,
                parameters: {
                    type: "OBJECT",
                    properties: this._convertParameters(def.parameters || {}),
                    required: Object.keys(def.parameters || {})
                }
            };
            declarations.push(declaration);
        }

        return declarations;
    }

    /**
     * Execute a tool call from Gemini
     * @param {string} toolName - Name of the tool to execute
     * @param {Object} args - Arguments passed by Gemini
     * @returns {Promise<any>} Result of tool execution
     */
    async executeToolCall(toolName, args) {
        // Try to find as device command (case insensitive)
        const commandKey = Array.from(this.commands.keys()).find(
            key => key.toLowerCase() === toolName.toLowerCase()
        );
        
        if (commandKey) {
            const command = this.commands.get(commandKey);
            const { device_name, ...params } = args;
            
            if (!device_name) {
                throw new Error('Device name is required for device commands');
            }
            
            if (command.handler) {
                // Use custom handler if provided
                return await command.handler(device_name, params);
            } else {
                // Default handler - will be implemented in DewabAPI
                throw new Error('Default command handler not set. Please provide a handler or use DewabAPI.');
            }
        }

        // Try to find as custom function
        const functionKey = Array.from(this.customFunctions.keys()).find(
            key => key.toLowerCase() === toolName.toLowerCase()
        );
        
        if (functionKey) {
            const func = this.customFunctions.get(functionKey);
            return await func.handler(args);
        }

        throw new Error(`Unknown tool: ${toolName}`);
    }

    /**
     * Convert parameter definitions to Gemini format
     * @private
     */
    _convertParameters(params) {
        const converted = {};
        for (const [key, def] of Object.entries(params)) {
            converted[key] = {
                type: (def.type || 'string').toUpperCase(),
                description: def.description || `Parameter ${key}`,
                ...(def.enum && { enum: def.enum })
            };
        }
        return converted;
    }

    /**
     * Get information about registered tools
     * @returns {Object} Summary of registered tools
     */
    getRegisteredTools() {
        return {
            commands: Array.from(this.commands.keys()),
            functions: Array.from(this.customFunctions.keys()),
            total: this.commands.size + this.customFunctions.size
        };
    }

    /**
     * Clear all registered tools
     */
    clear() {
        this.commands.clear();
        this.customFunctions.clear();
    }
} 