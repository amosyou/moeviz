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
from typing import Dict, Any

from moeviz.config import (SERVER_HOST, SERVER_PORT, ENABLE_CORS, MODEL_CONFIGS, 
                          MAX_NEW_TOKENS, THREAD_POOL_WORKERS, get_client_config)


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


def get_experts(layer_id):

    def hook(module, input, output):
        selected_experts = process_router_logits(output.clone().detach(), top_k=4)
        tokens = tokens_queue.get()
        
        routing_data = {
            "layer_id": layer_id,
            "tokens": tokens,
            "selected_experts": selected_experts.cpu().tolist(),
        }
        
        # Add decoded tokens if tokenizer is available
        if 'current_tokenizer' in globals() and current_tokenizer is not None:
            try:
                if isinstance(tokens, list):
                    # Make sure to convert tokens to integers for decoding
                    decoded_tokens = []
                    for t in tokens:
                        try:
                            token_str = current_tokenizer.decode([int(t)])
                            decoded_tokens.append(token_str)
                        except Exception as e:
                            print(f"Error decoding token {t}: {e}")
                            decoded_tokens.append(f"[ERROR:{t}]")
                else:
                    try:
                        decoded_tokens = [current_tokenizer.decode([int(tokens)])]
                    except:
                        decoded_tokens = [f"[ERROR:{tokens}]"]
                
                routing_data["decoded_tokens"] = decoded_tokens
                print(f"Successfully decoded {len(decoded_tokens)} tokens")
            except Exception as e:
                print(f"Error decoding tokens: {e}")
                print(f"Token type: {type(tokens)}")
                print(f"Token value: {tokens}")
        else:
            print("No tokenizer available for decoding")
            
        print(f"Routing data with {len(tokens) if isinstance(tokens, list) else 1} tokens being sent to client")
        routing_queue.put(routing_data)
    
    return hook

def process_router_logits(router_logits, top_k):
    # router_logits: (batch * sequence_length, n_experts)
    routing_weights = F.softmax(router_logits, dim=1, dtype=torch.float)
    routing_weights, selected_experts = torch.topk(routing_weights, top_k, dim=-1)
    return selected_experts


def get_token():

    def hook(module, input):
        tokens = input[0].clone().detach().cpu().squeeze().tolist()
        # Ensure tokens is always a list
        if not isinstance(tokens, list):
            tokens = [tokens]
        tokens_queue.put(tokens)
    
    return hook


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
    
    tokens_queue.empty()
    model, tokenizer = load_model(model_id)
    
    # Make tokenizer available globally for token decoding
    global current_tokenizer
    current_tokenizer = tokenizer
        
    i = 0
    # register hook
    token_hook = (model.model.embed_tokens).register_forward_pre_hook(get_token())
    router_hook = (model.model.layers[i].mlp.gate).register_forward_hook(get_experts(i))
            
    messages = [
        {"role": "system", "content": "You are Qwen, created by Alibaba Cloud. You are a helpful assistant."},
        {"role": "user", "content": prompt}
    ]
    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True
    )

    model_inputs = tokenizer([text], return_tensors="pt").to(model.device)
    
    def run_generation():
        return model.generate(
            **model_inputs,
            max_new_tokens=MAX_NEW_TOKENS
        )

    # prevent blocking of event loop
    generated_ids = await asyncio.get_event_loop().run_in_executor(
        thread_pool, 
        run_generation
    )
    generated_text = tokenizer.decode(generated_ids[0], skip_special_tokens=True)

    await sio.emit('generation_complete')
    
    token_hook.remove()
    router_hook.remove()
    
    return {"message": generated_text}


@app.get("/config")
async def get_config():
    """Return configuration for the client"""
    return get_client_config()

if __name__ == "__main__":
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)