import asyncio
import json
import socketio
import torch
import torch.nn.functional as F
import uvicorn

from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from queue import Queue
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer
from typing import Dict, Any, List

from moeviz.config import (SERVER_HOST, SERVER_PORT, ENABLE_CORS, MODEL_CONFIGS, 
                          MAX_NEW_TOKENS, THREAD_POOL_WORKERS, get_client_config)
from moeviz.model_adapters import get_model_adapter


class GenerateRequest(BaseModel):
    prompt: str
    model: str


thread_pool = ThreadPoolExecutor(max_workers=THREAD_POOL_WORKERS)


app = FastAPI()

if ENABLE_CORS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio)

app.mount("/socket.io", socket_app)


tokens_queue = Queue()
routing_queue = Queue()

async def process_routing_queue():
    while True:
        if not routing_queue.empty():
            data = routing_queue.get()
            await sio.emit('routing_update', data)
        await asyncio.sleep(0.001)

@app.on_event("startup")
async def startup_event():
    print("starting up and creating task")
    asyncio.create_task(process_routing_queue())


# Model configurations are now imported from config.py

loaded_models = {}

def load_model(model_id):
    """Load a model and tokenizer by model_id from MODEL_CONFIGS."""
    if model_id not in MODEL_CONFIGS:
        raise ValueError(f"Unknown model: {model_id}")
    
    if model_id in loaded_models:
        return loaded_models[model_id]
    
    try:
        model_name = MODEL_CONFIGS[model_id]["path"]
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype="auto",
            device_map="auto"
        )
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        loaded_models[model_id] = (model, tokenizer)
        return loaded_models[model_id]
    except Exception as e:
        print(f"Error loading model {model_id}: {e}")
        return None


# These functions are now provided by the model adapters in model_adapters.py


@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")

@sio.event
async def disconnect(sid):
    print(f"Client disconnected: {sid}")

@app.post("/generate")
async def generate_text(request: GenerateRequest):
    prompt = request.prompt
    model_id = request.model
    print(f"Received prompt: {prompt}")
    
    # Clean up any tokens in the queue
    while not tokens_queue.empty():
        tokens_queue.get()
    
    # Load the model and tokenizer
    model, tokenizer = load_model(model_id)
    if not model or not tokenizer:
        return {"error": f"Failed to load model {model_id}"}
    
    # Get the model config
    model_config = MODEL_CONFIGS.get(model_id, {})
    if not model_config:
        return {"error": f"No configuration found for model {model_id}"}
    
    # Get the appropriate adapter for this model
    try:
        adapter = get_model_adapter(model_config)
    except ValueError as e:
        return {"error": str(e)}
    
    # Layer to monitor (currently just using the first layer)
    layer_id = 0
    
    # Register hooks using the adapter
    hooks = adapter.register_hooks(model, layer_id, tokens_queue, routing_queue, tokenizer)
    
    # Prepare the prompt
    # We use a system message appropriate for the model type, with fallback to a generic one
    system_content = "You are a helpful assistant."
    if model_config.get('model_type') == 'qwen':
        system_content = "You are Qwen, created by Alibaba Cloud. You are a helpful assistant."
    elif model_config.get('model_type') == 'mixtral':
        system_content = "You are a helpful, respectful and honest assistant."
        
    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": prompt}
    ]
    
    # Apply chat template - handle differences between models
    try:
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True
        )
    except Exception as e:
        print(f"Error applying chat template: {e}")
        # Fallback to simpler prompt
        text = f"<s>[INST] {prompt} [/INST]"
    
    # Tokenize input and prepare for generation
    model_inputs = tokenizer([text], return_tensors="pt").to(model.device)
    
    def run_generation():
        return model.generate(
            **model_inputs,
            max_new_tokens=MAX_NEW_TOKENS
        )

    # Prevent blocking of event loop
    try:
        generated_ids = await asyncio.get_event_loop().run_in_executor(
            thread_pool, 
            run_generation
        )
        generated_text = tokenizer.decode(generated_ids[0], skip_special_tokens=True)
    except Exception as e:
        print(f"Generation error: {e}")
        for hook in hooks:
            hook.remove()
        return {"error": f"Generation failed: {str(e)}"}

    # Notify client that generation is complete
    await sio.emit('generation_complete')
    
    # Remove hooks
    for hook in hooks:
        hook.remove()
    
    return {"message": generated_text}


@app.get("/config")
async def get_config():
    """Return configuration for the client"""
    return get_client_config()

if __name__ == "__main__":
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)