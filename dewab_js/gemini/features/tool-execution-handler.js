import { EventEmitter } from 'https://cdn.skypack.dev/eventemitter3';
import { Logger } from '../gemini-utils.js';

/**
 * ToolExecutionHandler manages tool-related conversation features.
 * It handles tool call processing, tool response coordination, and tool-specific state management.
 * 
 * Events emitted:
 * - 'tool_call_received': Tool call received from API
 * - 'tool_cancellation_received': Tool call cancelled by API
 * - 'tool_execution_started': Tool execution has begun
 * - 'tool_execution_completed': Tool execution has finished
 * - 'tool_error': Error during tool processing
 */
export class ToolExecutionHandler extends EventEmitter {
    /**
     * Creates a new ToolExecutionHandler instance
     * @param {string} [name='ToolExecutionHandler'] - Name for logging purposes
     */
    constructor(name = 'ToolExecutionHandler') {
        super();
        
        this.name = name;
        this.activeToolCalls = new Map(); // Track active tool calls
        this.toolCallHistory = [];
        this.totalToolCalls = 0;
        this.totalCancellations = 0;
        
        Logger.debug(this.name, 'ToolExecutionHandler initialized');
    }

    /**
     * Processes a tool call request from the API
     * @param {object} toolCall - Tool call object from API
     */
    processToolCall(toolCall) {
        if (!toolCall || typeof toolCall !== 'object') {
            Logger.error(this.name, 'Invalid tool call received:', toolCall);
            return;
        }

        this.totalToolCalls++;
        const toolCallId = toolCall.id || `tool_${this.totalToolCalls}`;
        
        Logger.info(this.name, `Tool call received #${this.totalToolCalls}:`, {
            id: toolCallId,
            name: toolCall.name,
            hasArgs: !!toolCall.args
        });

        // Track the active tool call
        const toolCallData = {
            id: toolCallId,
            name: toolCall.name,
            args: toolCall.args,
            startTime: new Date().toISOString(),
            status: 'received'
        };
        
        this.activeToolCalls.set(toolCallId, toolCallData);
        this.toolCallHistory.push({ ...toolCallData });

        this.emit('tool_call_received', {
            toolCall: toolCall,
            callNumber: this.totalToolCalls,
            activeCalls: this.activeToolCalls.size
        });

        return toolCallData;
    }

    /**
     * Processes a tool call cancellation from the API
     * @param {object} cancellation - Tool cancellation object
     */
    processToolCancellation(cancellation) {
        if (!cancellation || typeof cancellation !== 'object') {
            Logger.error(this.name, 'Invalid tool cancellation received:', cancellation);
            return;
        }

        this.totalCancellations++;
        const cancellationId = cancellation.id || 'unknown';

        Logger.info(this.name, `Tool cancellation received #${this.totalCancellations}:`, {
            id: cancellationId,
            reason: cancellation.reason
        });

        // Update active tool call if it exists
        if (this.activeToolCalls.has(cancellationId)) {
            const toolCallData = this.activeToolCalls.get(cancellationId);
            toolCallData.status = 'cancelled';
            toolCallData.cancellationTime = new Date().toISOString();
            toolCallData.cancellationReason = cancellation.reason;
            
            // Remove from active calls
            this.activeToolCalls.delete(cancellationId);
        }

        this.emit('tool_cancellation_received', {
            cancellation: cancellation,
            cancellationNumber: this.totalCancellations,
            activeCalls: this.activeToolCalls.size
        });

        return cancellation;
    }

    /**
     * Marks a tool call as started (execution begun)
     * @param {string} toolCallId - ID of the tool call
     * @param {object} [metadata={}] - Additional execution metadata
     */
    markToolExecutionStarted(toolCallId, metadata = {}) {
        if (this.activeToolCalls.has(toolCallId)) {
            const toolCallData = this.activeToolCalls.get(toolCallId);
            toolCallData.status = 'executing';
            toolCallData.executionStartTime = new Date().toISOString();
            toolCallData.executionMetadata = metadata;

            Logger.debug(this.name, `Tool execution started: ${toolCallId}`);
            
            this.emit('tool_execution_started', {
                toolCallId,
                toolCall: toolCallData,
                metadata
            });
        }
    }

    /**
     * Marks a tool call as completed
     * @param {string} toolCallId - ID of the tool call
     * @param {object} result - Tool execution result
     * @param {boolean} [success=true] - Whether execution was successful
     */
    markToolExecutionCompleted(toolCallId, result, success = true) {
        if (this.activeToolCalls.has(toolCallId)) {
            const toolCallData = this.activeToolCalls.get(toolCallId);
            toolCallData.status = success ? 'completed' : 'failed';
            toolCallData.completionTime = new Date().toISOString();
            toolCallData.result = result;
            toolCallData.success = success;

            // Calculate execution duration
            if (toolCallData.executionStartTime) {
                const startTime = new Date(toolCallData.executionStartTime);
                const endTime = new Date(toolCallData.completionTime);
                toolCallData.executionDurationMs = endTime - startTime;
            }

            Logger.debug(this.name, `Tool execution ${success ? 'completed' : 'failed'}: ${toolCallId}`, {
                duration: toolCallData.executionDurationMs,
                success
            });

            // Remove from active calls
            this.activeToolCalls.delete(toolCallId);

            this.emit('tool_execution_completed', {
                toolCallId,
                toolCall: toolCallData,
                result,
                success,
                activeCalls: this.activeToolCalls.size
            });
        }
    }

    /**
     * Handles tool execution errors
     * @param {string} toolCallId - ID of the tool call
     * @param {Error|string} error - Error that occurred
     */
    handleToolError(toolCallId, error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        Logger.error(this.name, `Tool execution error for ${toolCallId}:`, errorMessage);

        if (this.activeToolCalls.has(toolCallId)) {
            const toolCallData = this.activeToolCalls.get(toolCallId);
            toolCallData.status = 'error';
            toolCallData.error = errorMessage;
            toolCallData.errorTime = new Date().toISOString();

            // Remove from active calls
            this.activeToolCalls.delete(toolCallId);
        }

        this.emit('tool_error', {
            toolCallId,
            error: errorMessage,
            activeCalls: this.activeToolCalls.size
        });
    }

    /**
     * Gets information about a specific tool call
     * @param {string} toolCallId - ID of the tool call
     * @returns {object|null} Tool call data or null if not found
     */
    getToolCall(toolCallId) {
        return this.activeToolCalls.get(toolCallId) || null;
    }

    /**
     * Gets all active tool calls
     * @returns {Array} Array of active tool call data
     */
    getActiveToolCalls() {
        return Array.from(this.activeToolCalls.values());
    }

    /**
     * Gets tool execution history
     * @param {number} [limit] - Maximum number of entries to return
     * @returns {Array} Array of tool call history
     */
    getHistory(limit) {
        const history = [...this.toolCallHistory].reverse(); // Most recent first
        return limit ? history.slice(0, limit) : history;
    }

    /**
     * Resets tool execution state
     * @param {boolean} [clearHistory=false] - Whether to clear history as well
     */
    reset(clearHistory = false) {
        const hadActiveCalls = this.activeToolCalls.size > 0;
        
        this.activeToolCalls.clear();
        
        if (clearHistory) {
            this.toolCallHistory = [];
            this.totalToolCalls = 0;
            this.totalCancellations = 0;
        }
        
        if (hadActiveCalls) {
            Logger.debug(this.name, 'Tool execution state reset');
        }
    }

    /**
     * Gets current tool execution state
     * @returns {object} Current tool state
     */
    getState() {
        return {
            activeToolCalls: this.getActiveToolCalls(),
            totalToolCalls: this.totalToolCalls,
            totalCancellations: this.totalCancellations,
            activeCallsCount: this.activeToolCalls.size,
            hasActiveCalls: this.activeToolCalls.size > 0
        };
    }

    /**
     * Checks if handler is currently processing tools
     * @returns {boolean} True if there are active tool calls
     */
    isProcessing() {
        return this.activeToolCalls.size > 0;
    }

    /**
     * Gets tool execution statistics
     * @returns {object} Processing statistics
     */
    getStats() {
        const completed = this.toolCallHistory.filter(call => call.status === 'completed').length;
        const failed = this.toolCallHistory.filter(call => call.status === 'failed').length;
        const cancelled = this.toolCallHistory.filter(call => call.status === 'cancelled').length;
        
        return {
            totalCalls: this.totalToolCalls,
            totalCancellations: this.totalCancellations,
            activeCalls: this.activeToolCalls.size,
            completedCalls: completed,
            failedCalls: failed,
            cancelledCalls: cancelled,
            successRate: this.totalToolCalls > 0 ? (completed / this.totalToolCalls * 100).toFixed(1) : 0
        };
    }

    /**
     * Cancels all active tool calls (local cancellation)
     */
    cancelAllActiveCalls() {
        const activeCalls = Array.from(this.activeToolCalls.keys());
        
        activeCalls.forEach(toolCallId => {
            this.markToolExecutionCompleted(toolCallId, { cancelled: true }, false);
        });
        
        if (activeCalls.length > 0) {
            Logger.info(this.name, `Cancelled ${activeCalls.length} active tool calls`);
        }
    }
} 