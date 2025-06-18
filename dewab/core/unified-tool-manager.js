/**
 * UnifiedToolManager bridges the ToolRegistry with Gemini's tool system
 * It implements the same interface as the original ToolManager but uses our registry
 */
export class UnifiedToolManager {
    constructor(toolRegistry, dewabApi) {
        this.toolRegistry = toolRegistry; // ToolRegistry instance
        this.dewabApi = dewabApi; // Main Dewab instance (formerly DewabAPI)
        this.tools = new Map();
        
        // Initialize tools from registry
        this._syncToolsFromRegistry();
    }

    /**
     * Sync tools from the registry to our internal map
     * @private
     */
    _syncToolsFromRegistry() {
        // Clear existing tools
        this.tools.clear();
        
        // Get all tool declarations from registry
        const declarations = this.toolRegistry.getGeminiToolDeclarations();
        
        // Create tool wrappers for each declaration
        for (const declaration of declarations) {
            const toolWrapper = {
                getDeclaration: () => declaration,
                execute: async (args) => {
                    // Set default handler for device commands if not already set
                    const commandKey = Array.from(this.toolRegistry.commands.keys()).find(
                        key => key.toLowerCase() === declaration.name.toLowerCase()
                    );
                    
                    if (commandKey && !this.toolRegistry.commands.get(commandKey).handler) {
                        // Set the handler to use dewabApi
                        this.toolRegistry.commands.get(commandKey).handler = async (deviceName, params) => {
                            return await this.dewabApi.device(deviceName).sendCommand(commandKey, params);
                        };
                    }
                    
                    // Execute through registry
                    return await this.toolRegistry.executeToolCall(declaration.name, args);
                }
            };
            
            this.tools.set(declaration.name, toolWrapper);
        }
    }

    /**
     * Register a tool (for compatibility with existing code)
     * @param {string} name - Tool name
     * @param {Object} tool - Tool object with getDeclaration and execute methods
     */
    registerTool(name, tool) {
        this.tools.set(name, tool);
    }

    /**
     * Get all tool declarations for Gemini
     * @returns {Array} Array of tool declarations
     */
    getToolDeclarations() {
        // Always sync from registry to get latest tools
        this._syncToolsFromRegistry();
        
        const declarations = [];
        for (const tool of this.tools.values()) {
            if (tool.getDeclaration) {
                declarations.push(tool.getDeclaration());
            }
        }
        return declarations;
    }

    /**
     * Handle a tool call from Gemini
     * @param {Object} toolCall - Tool call details from Gemini
     * @returns {Promise<Object>} Tool response
     */
    async handleToolCall(toolCall) {
        const { name, args, id } = toolCall;
        
        // Always sync to ensure we have latest tools
        this._syncToolsFromRegistry();
        
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Tool not found: ${name}`);
        }

        try {
            const result = await tool.execute(args);
            return {
                id: id,
                output: result
            };
        } catch (error) {
            console.error(`Error executing tool ${name}:`, error);
            throw error;
        }
    }

    /**
     * Get registered tools info
     * @returns {Array} Array of tool info
     */
    getRegisteredTools() {
        return Array.from(this.tools.keys()).map(name => ({
            name: name,
            declaration: this.tools.get(name)?.getDeclaration?.() || null
        }));
    }
} 