import './style.css'
import * as d3 from 'd3';
import { io } from 'socket.io-client'
import { initVisualization, createVisualization, clearVisualization, setExpertCount, setShowTokenIds } from './histogram.js'
import { serverUrl, modelConfigs } from './config.js'

// modelConfigs are now imported from config.js

// Create HTML content with model selector
document.querySelector('#app').innerHTML = `
  <div class="container">
    <h1>moeviz</h1>
    
    <div class="model-selector-container">
      <label for="model-selector">Select Model:</label>
      <select id="model-selector" class="model-selector">
        ${Object.entries(modelConfigs).map(([id, config]) => 
          `<option value="${id}" data-expert-count="${config.expertCount}">${config.name}</option>`
        ).join('')}
      </select>
      <div id="model-info" class="model-info">Expert count: ${modelConfigs['qwen-1.5-moe-a2.7b'].expertCount}</div>
    </div>
    
    <div class="prompt-container">
      <input type="text" id="prompt-input" class="prompt-input" placeholder="Enter a prompt for the model...">
      <button id="submit-prompt" class="submit-button">Generate</button>
      <div id="status" class="status"></div>
    </div>
    
    <div id="token-display-container" class="token-display-container">
      <div class="token-display-header">
        <h3>Tokens</h3>
        <div class="display-options">
          <label class="toggle-switch">
            <input type="checkbox" id="show-token-ids-checkbox">
            <span class="toggle-label">Show Token IDs</span>
          </label>
        </div>
      </div>
      <div id="token-display" class="token-display"></div>
    </div>
  </div>
  
  <div id="container"></div>
`

const socket = io(serverUrl, {
  transports: ['websocket'],
  upgrade: false
});
let routingData = [];
let isGenerating = false;
let currentModel = 'qwen-1.5-moe-a2.7b';

// DOM elements
const promptInput = document.getElementById('prompt-input');
const submitButton = document.getElementById('submit-prompt');
const statusElement = document.getElementById('status');
const modelSelector = document.getElementById('model-selector');
const modelInfo = document.getElementById('model-info');
let tokenDisplay = document.getElementById('token-display'); // Define as let so we can reassign later
let showTokenIdsCheckbox = document.getElementById('show-token-ids-checkbox');

// State for display mode
let showTokenIds = false;

// initialize with default model expert count
setExpertCount(modelConfigs[currentModel].expertCount);

// handle model selection change
modelSelector.addEventListener('change', (e) => {
  currentModel = e.target.value;
  const expertCount = parseInt(e.target.selectedOptions[0].dataset.expertCount);
  
  modelInfo.textContent = `Expert count: ${expertCount}`;
  
  setExpertCount(expertCount);
  clearVisualization();
  
  routingData = [];
  
  statusElement.textContent = `Model changed to ${e.target.selectedOptions[0].text}`;
});

// socket.io event listeners
socket.on('connect', () => {
  console.log('Connected to server');
  statusElement.textContent = 'Ready';
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  statusElement.textContent = 'Disconnected';
});

socket.on('routing_update', (data) => {
  console.log('Received routing update:', data);
  
  // Check for token display
  if (!tokenDisplay) {
    const tokenDisplayEl = document.getElementById('token-display');
    if (tokenDisplayEl) {
      tokenDisplay = tokenDisplayEl;
      console.log('Token display found and initialized during routing update');
    } else {
      console.error('Token display element still not found during routing update');
    }
  }
  
  const transformedData = processRoutingData(data);
  
  routingData = [...routingData, ...transformedData];
  
  clearVisualization();
  createVisualization(routingData);
  
  statusElement.textContent = `Processing... ${routingData.length} tokens`;
});

function processRoutingData(data) {
  const transformedData = [];

  // tokens
  // 1d or scalar
  const tokenIds = Array.isArray(data.tokens) ? data.tokens : [data.tokens];
  
  // decoded tokens if available
  const decodedTokens = data.decoded_tokens || [];
  console.log('Decoded tokens:', decodedTokens);
  
  // Update token display if we have decoded tokens
  if (tokenDisplay && decodedTokens && decodedTokens.length > 0) {
    console.log('Updating token display with:', { tokenIds, decodedTokens, position: routingData.length });
    // Create and display token spans directly here
    // Use a fixed max value for consistency with the histogram
    const MAX_TOKENS = 150; // Fixed maximum for consistent colors
    const colorScale = d3.scaleSequential(d3.interpolateViridis)
      .domain([0, MAX_TOKENS]); 

    // Calculate the actual token positions - we need to do this carefully
    // to match how they're displayed in the histogram
    // Since each token appears multiple times (once per expert), 
    // we need to use the token sequence index, not the routingData length
    
    // Calculate the base position - this should be the number of unique tokens processed so far
    // not the number of token-expert pairs
    const uniqueTokenCount = routingData.length > 0 ? 
      new Set(routingData.map(item => item.token_pos)).size : 0;
    
    console.log(`Current unique token count: ${uniqueTokenCount}`);
    
    decodedTokens.forEach((decodedToken, index) => {
      // The real position is the current unique token count plus the index
      const tokenPosition = uniqueTokenCount + index;
      
      const tokenSpan = document.createElement('span');
      tokenSpan.className = 'token';
      // Set display text based on the current mode (text or token IDs)
      const displayText = showTokenIds ? tokenIds[index] : decodedToken;
      tokenSpan.textContent = displayText;
      tokenSpan.setAttribute('data-decoded-token', decodedToken);
      tokenSpan.id = `token-${tokenPosition}`;
      tokenSpan.setAttribute('data-token-id', tokenIds[index] || '');
      tokenSpan.setAttribute('data-position', tokenPosition);
      tokenSpan.style.backgroundColor = colorScale(tokenPosition);
      
      // Set text color based on background brightness
      const color = d3.color(colorScale(tokenPosition));
      const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
      tokenSpan.style.color = brightness > 125 ? '#000' : '#fff';
      
      tokenDisplay.appendChild(tokenSpan);
    });
    
    // Scroll to the bottom
    tokenDisplay.scrollTop = tokenDisplay.scrollHeight;
  } else {
    console.warn('Not updating token display:', { 
      displayExists: !!tokenDisplay, 
      haveDecodedTokens: !!(decodedTokens && decodedTokens.length > 0)
    });
  }

  // experts
  // 2d
  // dim 0 corresponds to tokens
  // dim 1 corresponds to experts for each token
  const selectedExperts = data.selected_experts;

  if (Array.isArray(tokenIds)) {
    // for each token
    tokenIds.forEach((tokenId, tokenIndex) => {
      // get experts for this token
      let expertsForToken;
      
      if (Array.isArray(selectedExperts[0])) {
        // handle case where experts 2d array
        expertsForToken = selectedExperts[tokenIndex] || [];
      } else {
        // handle case where all tokens might share the same experts
        expertsForToken = selectedExperts;
      }

      // Calculate the base position - use the unique token count calculation
      const uniqueTokenCount = routingData.length > 0 ? 
        new Set(routingData.map(item => item.token_pos)).size : 0;
      const tokenPosition = uniqueTokenCount + tokenIndex;
      
      // create an entry for each expert this token is routed to
      expertsForToken.forEach(expertId => {
        transformedData.push({
          layer_id: data.layer_id,
          token_id: tokenId,
          expert_id: expertId,
          token_pos: tokenPosition, // Use consistent token position
          decoded_token: decodedTokens[tokenIndex] || String(tokenId)
        });
      });
    });
  } else {
    // handle scalar token case
    const tokenId = tokenIds;
    const expertsForToken = Array.isArray(selectedExperts[0]) ? 
      selectedExperts[0] : selectedExperts;
    const decodedToken = decodedTokens[0] || String(tokenId);

    // Calculate the base position - use the unique token count calculation
    const uniqueTokenCount = routingData.length > 0 ? 
      new Set(routingData.map(item => item.token_pos)).size : 0;
    const tokenPosition = uniqueTokenCount;
    
    expertsForToken.forEach(expertId => {
      transformedData.push({
        layer_id: data.layer_id,
        token_id: tokenId,
        expert_id: expertId,
        token_pos: tokenPosition, // Use consistent token position
        decoded_token: decodedToken
      });
    });
  }
  
  return transformedData;
}

socket.on('generation_complete', () => {
  isGenerating = false;
  submitButton.disabled = false;
  statusElement.textContent = 'Generation complete';
});

// event listeners
submitButton.addEventListener('click', () => {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    statusElement.textContent = 'Please enter a prompt';
    return;
  }
  
  startGeneration(prompt);
});

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const prompt = promptInput.value.trim();
    if (prompt) {
      startGeneration(prompt);
    }
  }
});

async function startGeneration(prompt) {
  if (isGenerating) return;
  
  isGenerating = true;
  submitButton.disabled = true;
  statusElement.textContent = 'Starting generation...';
  
  routingData = [];
  clearVisualization();
  
  // Make sure we have the tokenDisplay element and clear it
  tokenDisplay = document.getElementById('token-display');
  if (tokenDisplay) {
    console.log('Clearing token display');
    tokenDisplay.innerHTML = '';
  } else {
    console.error('Token display element not found during startGeneration');
  }
  
  try {
    const response = await fetch(`${serverUrl}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        prompt,
        model: currentModel,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to start generation');
    }
    
    const result = await response.json();
    statusElement.textContent = `Generation started: ${result.message || ''}`;
    
  } catch (error) {
    console.error('Error starting generation:', error);
    statusElement.textContent = `Error: ${error.message}`;
    isGenerating = false;
    submitButton.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize visualization
  initVisualization();
  
  // Make sure the token display is initialized
  tokenDisplay = document.getElementById('token-display');
  showTokenIdsCheckbox = document.getElementById('show-token-ids-checkbox');
  
  // Setup checkbox event listener for token ID display
  if (showTokenIdsCheckbox) {
    showTokenIdsCheckbox.addEventListener('change', function() {
      showTokenIds = this.checked;
      
      // Update all token displays
      const tokenElements = document.querySelectorAll('.token');
      tokenElements.forEach(token => {
        const tokenId = token.getAttribute('data-token-id');
        const decodedToken = token.getAttribute('data-decoded-token');
        token.textContent = showTokenIds ? tokenId : decodedToken;
      });
      
      // Update histogram mode
      setShowTokenIds(showTokenIds);
      
      // Redraw histogram if we have data
      if (routingData.length > 0) {
        clearVisualization();
        createVisualization(routingData);
      }
    });
  }
  
  if (tokenDisplay) {
    console.log('Token display initialized successfully');
  } else {
    console.error('Failed to find token-display element');
    // Create the token display container and element if they don't exist
    const app = document.querySelector('#app');
    if (app) {
      const container = document.querySelector('.container');
      if (container) {
        // Check if container already exists
        let tokenContainer = document.getElementById('token-display-container');
        if (!tokenContainer) {
          tokenContainer = document.createElement('div');
          tokenContainer.id = 'token-display-container';
          tokenContainer.className = 'token-display-container';
          
          const heading = document.createElement('h3');
          heading.textContent = 'Generated Tokens';
          tokenContainer.appendChild(heading);
          
          const display = document.createElement('div');
          display.id = 'token-display';
          display.className = 'token-display';
          tokenContainer.appendChild(display);
          
          // Insert after the prompt container
          const promptContainer = document.querySelector('.prompt-container');
          if (promptContainer && promptContainer.nextSibling) {
            container.insertBefore(tokenContainer, promptContainer.nextSibling);
          } else {
            container.appendChild(tokenContainer);
          }
          
          // Now get the reference
          tokenDisplay = document.getElementById('token-display');
          console.log('Created token display element');
        }
      }
    }
  }
  
  // Try to fetch server config if available
  try {
    const response = await fetch(`${serverUrl}/config`);
    if (response.ok) {
      const serverConfig = await response.json();
      // Update window config for use in config.js
      window.__MOEVIZ_CONFIG__ = serverConfig;
      // Comment out reload to prevent refresh loops
      // window.location.reload();
    }
  } catch (error) {
    console.warn('Could not fetch server config:', error);
  }
});