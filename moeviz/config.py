import os
from typing import Dict, Any

# Server configuration
SERVER_HOST = os.environ.get("MOEVIZ_SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.environ.get("MOEVIZ_SERVER_PORT", "8000"))

# Client configuration
BASE_URL = os.environ.get("MOEVIZ_BASE_URL", f"http://{SERVER_HOST}:{SERVER_PORT}")
ENABLE_CORS = os.environ.get("MOEVIZ_ENABLE_CORS", "true").lower() == "true"

# Model configurations with router information
MODEL_CONFIGS: Dict[str, Dict[str, Any]] = {
    'qwen-1.5-moe-a2.7b': {
        'name': 'Qwen1.5-MoE-A2.7B',
        'expert_count': 60,
        'path': 'Qwen/Qwen1.5-MoE-A2.7B',
        'model_type': 'qwen',
        'router_type': 'gate',
        'router_location': 'model.layers[{layer_id}].mlp.gate',
        'top_k': 4,
    },
    'mixtral-8x7b': {
        'name': 'Mixtral-8x7B',
        'expert_count': 8,
        'path': 'mistralai/Mixtral-8x7B-v0.1',
        'model_type': 'mixtral',
        'router_type': 'router',
        'router_location': 'model.layers[{layer_id}].block_sparse_moe.gate',
        'top_k': 2,
    },
}

# Generation settings
MAX_NEW_TOKENS = int(os.environ.get("MOEVIZ_MAX_NEW_TOKENS", "128"))

# Advanced settings
THREAD_POOL_WORKERS = int(os.environ.get("MOEVIZ_THREAD_POOL_WORKERS", "1"))

def get_client_config() -> Dict[str, Any]:
    """Return configuration values needed by the client"""
    return {
        "serverUrl": BASE_URL,
        "models": {
            model_id: {
                "name": config["name"],
                "expertCount": config["expert_count"]
            } for model_id, config in MODEL_CONFIGS.items()
        }
    }
