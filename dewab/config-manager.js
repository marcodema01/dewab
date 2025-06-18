/**
 * Configuration Manager for API keys and settings
 * Provides a centralized way to manage API keys that can be set from UI
 */

class ConfigManager {
    constructor() {
        this.config = {
            supabaseUrl: null,
            supabaseAnonKey: null,
            geminiApiKey: null
        };
        this.listeners = [];
        this._loadConfigFromLocalStorage(); // Load config on instantiation
    }

    /**
     * Load configuration values from local storage.
     * @private
     */
    _loadConfigFromLocalStorage() {
        try {
            const savedConfig = localStorage.getItem('apiConfig');
            if (savedConfig) {
                this.config = { ...this.config, ...JSON.parse(savedConfig) };
                console.debug('ConfigManager: Loaded config from local storage.', this.config);
            }
        } catch (error) {
            console.error('ConfigManager: Error loading config from local storage:', error);
        }
    }

    /**
     * Save configuration values to local storage.
     * @private
     */
    _saveConfigToLocalStorage() {
        try {
            localStorage.setItem('apiConfig', JSON.stringify(this.config));
            console.debug('ConfigManager: Saved config to local storage.', this.config);
        } catch (error) {
            console.error('ConfigManager: Error saving config to local storage:', error);
        }
    }

    /**
     * Set configuration values
     * @param {object} newConfig - Configuration object with keys to update
     */
    setConfig(newConfig) {
        const changed = {};
        
        Object.keys(newConfig).forEach(key => {
            if (this.config.hasOwnProperty(key) && this.config[key] !== newConfig[key]) {
                changed[key] = {
                    old: this.config[key],
                    new: newConfig[key]
                };
                this.config[key] = newConfig[key];
            }
        });

        // Notify listeners of changes
        if (Object.keys(changed).length > 0) {
            this.listeners.forEach(listener => {
                try {
                    listener(changed, this.config);
                } catch (error) {
                    console.error('Error in config listener:', error);
                }
            });
            this._saveConfigToLocalStorage(); // Save config after changes
        }
    }

    /**
     * Get a specific configuration value
     * @param {string} key - Configuration key
     * @returns {any} Configuration value
     */
    get(key) {
        return this.config[key];
    }

    /**
     * Get all configuration
     * @returns {object} All configuration values
     */
    getAll() {
        return { ...this.config };
    }

    /**
     * Check if all required keys are set
     * @returns {boolean} True if all required keys have values
     */
    isComplete() {
        return this.config.supabaseUrl && 
               this.config.supabaseAnonKey && 
               this.config.geminiApiKey;
    }

    /**
     * Get missing configuration keys
     * @returns {string[]} Array of missing key names
     */
    getMissingKeys() {
        return Object.keys(this.config).filter(key => !this.config[key]);
    }

    /**
     * Add a listener for configuration changes
     * @param {function} listener - Function called when config changes
     * @returns {function} Unsubscribe function
     */
    onChange(listener) {
        this.listeners.push(listener);
        
        // Return unsubscribe function
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    /**
     * Validate API key formats
     * @param {object} config - Configuration to validate
     * @returns {object} Validation result with errors
     */
    validate(config) {
        const errors = {};
        
        if (config.supabaseUrl) {
            try {
                new URL(config.supabaseUrl);
                if (!config.supabaseUrl.includes('supabase.co')) {
                    errors.supabaseUrl = 'URL should be a Supabase project URL';
                }
            } catch {
                errors.supabaseUrl = 'Invalid URL format';
            }
        }

        if (config.supabaseAnonKey) {
            if (!config.supabaseAnonKey.startsWith('eyJ')) {
                errors.supabaseAnonKey = 'Should be a JWT token starting with "eyJ"';
            }
        }

        if (config.geminiApiKey) {
            if (!config.geminiApiKey.startsWith('AIza')) {
                errors.geminiApiKey = 'Should start with "AIza"';
            }
        }

        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    }
}

// Export singleton instance
export const configManager = new ConfigManager(); 