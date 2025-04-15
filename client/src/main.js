import './style.css'
import { io } from 'socket.io-client'
import viteLogo from '/vite.svg'

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

// Import the D3 visualization after the DOM is updated
import { createVisualization, clearVisualization } from './histogram.js'

// Connect to Socket.io server
const socket = io()
let routingData = []
let isGenerating = false

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
  console.log('Received routing data:', data)
  
  routingData = [...routingData, ...data.routing_data]
  
  clearVisualization()
  createVisualization(routingData)
  
  statusElement.textContent = `Generating: ${data.progress || ''}`
})

socket.on('generation_complete', () => {
  isGenerating = false
  submitButton.disabled = false
  statusElement.textContent = 'Generation complete'
})

// event listeners
submitButton.addEventListener('click', () => {
  const prompt = promptInput.value.trim()
  if (!prompt) {
    statusElement.textContent = 'Please enter a prompt'
    return
  }
  
  startGeneration(prompt)
})

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const prompt = promptInput.value.trim()
    if (prompt) {
      startGeneration(prompt)
    }
  }
})

async function startGeneration(prompt) {
  if (isGenerating) return
  
  isGenerating = true
  submitButton.disabled = true
  statusElement.textContent = 'Starting generation...'
  
  // Clear previous data
  routingData = []
  clearVisualization()
  
  try {
    const response = await fetch('http://0.0.0.0:8000/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    })
    
    if (!response.ok) {
      throw new Error('Failed to start generation')
    }
    
    const result = await response.json()
    statusElement.textContent = `Generation started: ${result.message || ''}`
    
  } catch (error) {
    console.error('Error starting generation:', error)
    statusElement.textContent = `Error: ${error.message}`
    isGenerating = false
    submitButton.disabled = false
  }
}

// generate some sample data for initial display
function generateSampleData() {
  return Array.from({ length: 64 }, () => ({
    layer_id: Math.floor(Math.random() * 12),
    token_id: Math.floor(Math.random() * 1000),
    expert_id: Math.floor(Math.random() * 16 + 1),
    token_pos: Math.floor(Math.random() * 128)
  }))
}

// initialize with sample data
document.addEventListener('DOMContentLoaded', () => {
  createVisualization(generateSampleData())
})
