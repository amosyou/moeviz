import './style.css'
import { io } from 'socket.io-client'

document.querySelector('#app').innerHTML = `
  <div class="container">
    <h1>moeviz</h1>
    
    <div class="prompt-container">
      <input type="text" id="prompt-input" class="prompt-input" placeholder="Enter a prompt for the model...">
      <button id="submit-prompt" class="submit-button">Generate</button>
      <div id="status" class="status"></div>
    </div>
  </div>
  
  <div id="container"></div>
  
  <div class="description">
    <p>Each block represents a token, with the decoded token inside the block.</p>
    <p>Blocks are stacked vertically for each expert_id and colored according to token_pos value.</p>
    <p>Numbers above each column show the count of tokens for that expert_id.</p>
  </div>
`

import { initVisualization, createVisualization, clearVisualization } from './histogram.js'

const socket = io('http://0.0.0.0:8000', {
  transports: ['websocket'],
  upgrade: false
});
let routingData = [];
let isGenerating = false;

// DOM elements
const promptInput = document.getElementById('prompt-input')
const submitButton = document.getElementById('submit-prompt')
const statusElement = document.getElementById('status')

// socket.io event listeners
socket.on('connect', () => {
  console.log('Connected to server')
  statusElement.textContent = 'Ready'
})

socket.on('disconnect', () => {
  console.log('Disconnected from server')
  statusElement.textContent = 'Disconnected'
})

socket.on('routing_update', (data) => {
  console.log('Received routing update:', data)
  
  // tokens
  // 1d array of token ids

  // selected_experts
  // 2d array where each array contains expert ids for token
  
  const newRoutingData = processRoutingData(data);
  
  routingData = [...routingData, ...newRoutingData];
  
  // update visualization
  clearVisualization();
  createVisualization(routingData);
  
  statusElement.textContent = `Processing...`;
})

function processRoutingData(data) {
  const transformedData = [];
  const tokenIds = Array.isArray(data.tokens) ? data.tokens : [data.tokens];
  const selectedExperts = data.selected_experts;
  
  // experts
  // dim 0 corresponds to tokens
  // dim 1 corresponds to experts for each token
  
  if (Array.isArray(tokenIds)) {
    // for each token
    tokenIds.forEach((tokenId, tokenIndex) => {
      // Get experts for this token
      let expertsForToken;
      
      if (Array.isArray(selectedExperts[0])) {
        // experts 2d array
        expertsForToken = selectedExperts[tokenIndex] || [];
      } else {
        // all tokens might share same experts
        expertsForToken = selectedExperts;
      }
      
      // create an entry for each expert this token is routed to
      expertsForToken.forEach(expertId => {
        transformedData.push({
          layer_id: data.layer_id,
          token_id: tokenId,
          expert_id: expertId,
          token_pos: routingData.length + tokenIndex
        });
      });
    });
  } else {
    // scalar token
    const tokenId = tokenIds;
    const expertsForToken = Array.isArray(selectedExperts[0]) ? 
      selectedExperts[0] : selectedExperts;
    
    expertsForToken.forEach(expertId => {
      transformedData.push({
        layer_id: data.layer_id,
        token_id: tokenId,
        expert_id: expertId,
        token_pos: routingData.length
      });
    });
  }
  
  return transformedData;
}

socket.on('generation_complete', () => {
  isGenerating = false;
  submitButton.disabled = false;
  statusElement.textContent = 'Generation complete';
})

// event listeners
submitButton.addEventListener('click', () => {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    statusElement.textContent = 'Please enter a prompt';
    return;
  }
  
  startGeneration(prompt);
})

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const prompt = promptInput.value.trim();
    if (prompt) {
      startGeneration(prompt);
    }
  }
})

async function startGeneration(prompt) {
  if (isGenerating) return;
  
  isGenerating = true;
  submitButton.disabled = true;
  statusElement.textContent = 'Starting generation...';
  
  // clear previous data
  routingData = [];
  clearVisualization();
  
  try {
    const response = await fetch('http://0.0.0.0:8000/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
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

document.addEventListener('DOMContentLoaded', () => {
  initVisualization();
})