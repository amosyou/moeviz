import asyncio
import json
import socketio
import torch
import torch.nn.functional as F
import uvicorn

from collections import deque
from fastapi import FastAPI, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from queue import Queue
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer
from typing import Dict, Any


app = FastAPI()

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

class PromptRequest(BaseModel):
    prompt: str

model_name = "Qwen/Qwen1.5-MoE-A2.7B"
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype="auto",
    device_map="auto"
)
tokenizer = AutoTokenizer.from_pretrained(model_name)
model_loaded = True

# (layer_id, tokens, selected_experts)
scratch = deque()
routing_queue = Queue()

# Background task to process the queue
async def process_routing_queue():
    while True:
        if not routing_queue.empty():
            data = routing_queue.get()
            await sio.emit('routing_update', data)
        await asyncio.sleep(0.5) # 0.01

@app.on_event("startup")
async def startup_event():
    print("starting up and creating task")
    asyncio.create_task(process_routing_queue())

def get_experts(layer_id):

    def hook(module, input, output):
        selected_experts = process_router_logits(output.clone().detach(), top_k=4)
        tokens = scratch.popleft()
        
        routing_data = {
            "layer_id": layer_id,
            "tokens": tokens,
            "selected_experts": selected_experts.cpu().tolist(),
        }
        routing_queue.put(routing_data)
    
    return hook

def process_router_logits(router_logits, top_k):
    # router_logits: (batch * sequence_length, n_experts)
    routing_weights = F.softmax(router_logits, dim=1, dtype=torch.float)
    routing_weights, selected_experts = torch.topk(routing_weights, top_k, dim=-1)
    return selected_experts


def get_token():

    def hook(module, input):
        scratch.append(input[0].clone().detach().cpu().tolist())
    
    return hook


@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")

@sio.event
async def disconnect(sid):
    print(f"Client disconnected: {sid}")

@app.post("/generate")
async def generate_text(request: PromptRequest):
    prompt = request.prompt
    print(f"Received prompt: {prompt}")
    
    scratch.clear()
        
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
    # input_ids = tokenizer.encode(prompt, return_tensors="pt").to(model.device)
    generated_ids = model.generate(
        **model_inputs,
        max_new_tokens=128
    )
    generated_text = tokenizer.decode(generated_ids[0], skip_special_tokens=True)

    await sio.emit('generation_complete')
        
    return {"message": generated_text}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)