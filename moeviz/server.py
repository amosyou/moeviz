import socketio
import torch
import uvicorn

from collections import deque
from fastapi import FastAPI
from transformers import AutoModelForCausalLM, AutoTokenizer


app = FastAPI()

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio)

app.mount("/socket.io", socket_app)

model_name = "Qwen/Qwen1.5-MoE-A2.7B"
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype="auto",
    device_map="auto"
)
tokenizer = AutoTokenizer.from_pretrained(model_name)

# (layer_id, tokens, selected_experts)
# experts_list = deque()
scratch = deque()

def get_experts(layer_id):

    def hook(module, input, output):
        selected_experts = process_router_logits(output.clone().detach(), top_k=4)
        tokens = scratch.popleft()
        
        routing_data = {
            "layer_id": layer_id,
            "tokens": tokens,
            "selected_experts": selected_experts.cpu(),
        }
    
        # emit the data to connected clients
        sio.emit('routing_update', routing_data)

    return hook


def process_router_logits(router_logits, top_k):
    # router_logits: (batch * sequence_length, n_experts)
    routing_weights = F.softmax(router_logits, dim=1, dtype=torch.float)
    routing_weights, selected_experts = torch.topk(routing_weights, top_k, dim=-1)
    return selected_experts


def get_token():

    def hook(module, input):
        scratch.append(input[0].clone().detach().cpu())
    
    return hook


@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")

@sio.event
async def disconnect(sid):
    print(f"Client disconnected: {sid}")

@app.post("/generate")
async def generate_text(prompt: str):
    pass

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)