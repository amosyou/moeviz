// Configuration for the client

// Default configuration
const defaultConfig = {
  serverUrl: 'http://0.0.0.0:8000',
  models: {
    'qwen-1.5-moe-a2.7b': { name: 'Qwen1.5-MoE-A2.7B', expertCount: 60 },
    'mixtral-8x7b': { name: 'Mixtral-8x7B', expertCount: 8 },
  }
};

// Load custom config from window if available
const customConfig = window.__MOEVIZ_CONFIG__ || {};

// Merge configurations
export const config = {
  ...defaultConfig,
  ...customConfig,
  models: {
    ...defaultConfig.models,
    ...customConfig.models
  }
};

// Export configuration values
export const serverUrl = config.serverUrl;
export const modelConfigs = config.models;
