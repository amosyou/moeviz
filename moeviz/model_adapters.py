"""Model adapters for different MoE architectures."""

import torch
import torch.nn.functional as F
from typing import Any, Dict, List, Tuple, Optional, Union, Callable


class ModelAdapter:
    """Base class for model-specific router and token handlers."""
    
    def __init__(self, config: Dict[str, Any]):
        """Initialize adapter with model configuration.
        
        Args:
            config: Configuration dict with router_type, top_k, etc.
        """
        self.config = config
        self.top_k = config.get('top_k', 2)
        self.model_type = config.get('model_type', 'unknown')
    
    def get_router_path(self, layer_id: int) -> str:
        """Get the path to the router module for a specific layer.
        
        Args:
            layer_id: Index of the layer
            
        Returns:
            String representation of the path to the router module
        """
        router_location = self.config.get('router_location', '')
        return router_location.format(layer_id=layer_id)
    
    def resolve_module_path(self, model: Any, path: str) -> Any:
        """Resolve a dotted path to a module attribute.
        
        Args:
            model: The model object
            path: Dotted path or path with indexing
            
        Returns:
            The resolved module
        """
        # Handle special case with indexing like model.layers[0].mlp.gate
        if '[' in path and ']' in path:
            parts = []
            current = ""
            i = 0
            while i < len(path):
                if path[i] == '[':
                    if current:
                        parts.append(current)
                        current = ""
                    # Find the matching closing bracket
                    j = i + 1
                    bracket_content = ""
                    while j < len(path) and path[j] != ']':
                        bracket_content += path[j]
                        j += 1
                    if j < len(path):  # Found the closing bracket
                        # Evaluate the content inside brackets
                        index = eval(bracket_content)
                        parts.append(lambda obj, idx=index: obj[idx])
                        i = j + 1
                    else:
                        # No matching bracket found
                        current += path[i]
                        i += 1
                elif path[i] == '.':
                    if current:
                        parts.append(current)
                        current = ""
                    i += 1
                else:
                    current += path[i]
                    i += 1
            
            if current:
                parts.append(current)
            
            # Resolve the path
            obj = model
            for part in parts:
                if callable(part):
                    obj = part(obj)
                else:
                    obj = getattr(obj, part)
            return obj
        else:
            # Simple dotted path
            obj = model
            for part in path.split('.'):
                obj = getattr(obj, part)
            return obj
    
    def get_token_hook(self, token_queue: Any) -> Callable:
        """Create a hook for capturing input tokens. Shared across all adapters.
        
        Args:
            token_queue: Queue to put tokens into
            
        Returns:
            A hook function that can be registered with register_forward_pre_hook
        """
        def hook(module, input):
            tokens = input[0].clone().detach().cpu().squeeze().tolist()
            # Ensure tokens is always a list
            if not isinstance(tokens, list):
                tokens = [tokens]
            token_queue.put(tokens)
        
        return hook
    
    def get_router_hook(self, layer_id: int, token_queue: Any, routing_queue: Any, tokenizer: Any = None) -> Callable:
        """Create a hook for capturing router information.
        
        Args:
            layer_id: Index of the layer
            token_queue: Queue to get tokens from
            routing_queue: Queue to put routing data into
            tokenizer: Optional tokenizer for decoding tokens
            
        Returns:
            A hook function that can be registered with register_forward_hook
        """
        raise NotImplementedError("Subclasses must implement get_router_hook")
    
    def process_router_logits(self, router_logits: torch.Tensor) -> torch.Tensor:
        """Process router logits to get selected experts.
        
        Args:
            router_logits: Logits from the router
            
        Returns:
            Tensor of selected experts
        """
        # Default implementation for most models
        routing_weights = F.softmax(router_logits, dim=-1, dtype=torch.float)
        routing_weights, selected_experts = torch.topk(routing_weights, self.top_k, dim=-1)
        return selected_experts
    
    def register_hooks(self, model: Any, layer_id: int, token_queue: Any, routing_queue: Any, tokenizer: Any = None) -> List[Any]:
        """Register all necessary hooks for the model.
        
        Args:
            model: The model to hook
            layer_id: Index of the layer to hook
            token_queue: Queue for tokens
            routing_queue: Queue for routing data
            tokenizer: Optional tokenizer for decoding tokens
            
        Returns:
            List of hook handles
        """
        hooks = []
        
        # Get token hook
        token_hook = self.get_token_hook(token_queue)
        token_hook_handle = model.model.embed_tokens.register_forward_pre_hook(token_hook)
        hooks.append(token_hook_handle)
        
        # Get router hook for specific layer
        router_path = self.get_router_path(layer_id)
        router_module = self.resolve_module_path(model, router_path)
        router_hook = self.get_router_hook(layer_id, token_queue, routing_queue, tokenizer)
        router_hook_handle = router_module.register_forward_hook(router_hook)
        hooks.append(router_hook_handle)
        
        return hooks


class QwenMoEAdapter(ModelAdapter):
    """Adapter for Qwen MoE models."""
    
    def get_router_hook(self, layer_id: int, token_queue: Any, routing_queue: Any, tokenizer: Any = None) -> Callable:
        """Create router hook for Qwen models."""
        def hook(module, input, output):
            selected_experts = self.process_router_logits(output.clone().detach())
            tokens = token_queue.get()
            
            routing_data = {
                "layer_id": layer_id,
                "tokens": tokens,
                "selected_experts": selected_experts.cpu().tolist(),
            }
            
            # Add decoded tokens if tokenizer is available
            if tokenizer is not None:
                try:
                    if isinstance(tokens, list):
                        # Make sure to convert tokens to integers for decoding
                        decoded_tokens = []
                        for t in tokens:
                            try:
                                token_str = tokenizer.decode([int(t)])
                                decoded_tokens.append(token_str)
                            except Exception as e:
                                print(f"Error decoding token {t}: {e}")
                                decoded_tokens.append(f"[ERROR:{t}]")
                    else:
                        try:
                            decoded_tokens = [tokenizer.decode([int(tokens)])]
                        except:
                            decoded_tokens = [f"[ERROR:{tokens}]"]
                    
                    routing_data["decoded_tokens"] = decoded_tokens
                    print(f"Successfully decoded {len(decoded_tokens)} tokens")
                except Exception as e:
                    print(f"Error decoding tokens: {e}")
                    print(f"Token type: {type(tokens)}")
                    print(f"Token value: {tokens}")
            
            routing_queue.put(routing_data)
        
        return hook


class MixtralAdapter(ModelAdapter):
    """Adapter for Mixtral 8x7B models."""
    
    def get_router_hook(self, layer_id: int, token_queue: Any, routing_queue: Any, tokenizer: Any = None) -> Callable:
        """Create router hook for Mixtral models."""
        def hook(module, input, output):
            # Mixtral returns router probs and router logits
            router_logits = output
            if hasattr(output, "router_logits"):
                router_logits = output.router_logits
            
            selected_experts = self.process_router_logits(router_logits.clone().detach())
            tokens = token_queue.get()
            
            routing_data = {
                "layer_id": layer_id,
                "tokens": tokens,
                "selected_experts": selected_experts.cpu().tolist(),
            }
            
            # Add decoded tokens if tokenizer is available
            if tokenizer is not None:
                try:
                    if isinstance(tokens, list):
                        # Make sure to convert tokens to integers for decoding
                        decoded_tokens = []
                        for t in tokens:
                            try:
                                token_str = tokenizer.decode([int(t)])
                                decoded_tokens.append(token_str)
                            except Exception as e:
                                print(f"Error decoding token {t}: {e}")
                                decoded_tokens.append(f"[ERROR:{t}]")
                    else:
                        try:
                            decoded_tokens = [tokenizer.decode([int(tokens)])]
                        except:
                            decoded_tokens = [f"[ERROR:{tokens}]"]
                    
                    routing_data["decoded_tokens"] = decoded_tokens
                    print(f"Successfully decoded {len(decoded_tokens)} tokens")
                except Exception as e:
                    print(f"Error decoding tokens: {e}")
                    print(f"Token type: {type(tokens)}")
                    print(f"Token value: {tokens}")
            
            routing_queue.put(routing_data)
        
        return hook


def get_model_adapter(model_config: Dict[str, Any]) -> ModelAdapter:
    """Factory function to get the appropriate adapter for a model.
    
    Args:
        model_config: Configuration dict for the model
        
    Returns:
        An appropriate ModelAdapter instance
        
    Raises:
        ValueError: If no adapter is available for the model type
    """
    model_type = model_config.get('model_type', '').lower()
    
    if model_type == 'qwen':
        return QwenMoEAdapter(model_config)
    elif model_type == 'mixtral':
        return MixtralAdapter(model_config)
    else:
        raise ValueError(f"No adapter available for model type: {model_type}")