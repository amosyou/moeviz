import time
import torch
import torch.nn.functional as F

from collections import deque
from torch import nn
from transformers import AutoModelForCausalLM, AutoTokenizer


# (layer_id, tokens, selected_experts)
experts_list = deque()
scratch = deque()

def get_experts(layer_id):

    def hook(module, input, output):
        selected_experts = process_router_logits(output.clone().detach(), top_k=4)
        tokens = scratch.popleft()
        experts_list.append((layer_id, tokens, selected_experts.cpu()))

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


model_name = "Qwen/Qwen1.5-MoE-A2.7B"
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype="auto",
    device_map="auto"
)
tokenizer = AutoTokenizer.from_pretrained(model_name)

# TODO: add config to get top_k (per token)

i = 0
# register hook
token_hook = (model.model.embed_tokens).register_forward_pre_hook(get_token())
router_hook = (model.model.layers[i].mlp.gate).register_forward_hook(get_experts(i))


prompt = "Give me a short introduction to large language model."
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
# print(model_inputs.input_ids.shape)

torch.cuda.synchronize()
t1 = time.time()
generated_ids = model.generate(
    **model_inputs,
    max_new_tokens=512
)
torch.cuda.synchronize()
t2 = time.time()

print(f"runtime: {t2 - t1}")

# print(generated_ids)
# print(generated_ids.shape)
# generated_ids = [
#     output_ids[len(input_ids):] for input_ids, output_ids in zip(model_inputs.input_ids, generated_ids)
# ]
# response = tokenizer.batch_decode(generated_ids, skip_special_tokens=True)[0]

print(experts_list)
print(scratch)