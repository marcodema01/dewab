import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { configManager } from '../config-manager.js';

let supabase = null;

/**
 * Initialize or reinitialize the Supabase client with current configuration
 * @returns {object} Supabase client instance
 */
function initializeSupabaseClient() {
    const supabaseUrl = configManager.get('supabaseUrl');
    const supabaseAnonKey = configManager.get('supabaseAnonKey');
    
    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase URL and Anonymous Key must be configured. Please set them in the API Configuration section.');
    }
    
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.debug('Supabase Client Initialized with URL:', supabaseUrl);
    return supabase;
}

/**
 * Get the current Supabase client instance, initializing if needed
 * @returns {object} Supabase client instance
 */
export function getSupabaseClient() {
    if (!supabase) {
        return initializeSupabaseClient();
    }
    return supabase;
}

// Listen for configuration changes and reinitialize client
configManager.onChange((changed, config) => {
    if (changed.supabaseUrl || changed.supabaseAnonKey) {
        console.debug('Supabase configuration changed, reinitializing client...');
        try {
            initializeSupabaseClient();
        } catch (error) {
            console.error('Failed to reinitialize Supabase client:', error);
        }
    }
});

// Also export as 'supabase' for convenience
export { getSupabaseClient as supabase }; 