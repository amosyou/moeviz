import * as d3 from 'd3';

// global variables to store histogram state
let svg, g, width, height, margin;

// config
const config = {
  minBlockWidth: 45,     // increased minimum width for larger token IDs
  blockHeight: 22,       // increased height
  expertPadding: 0.15,   // reduced padding to fit more experts
  textSizeThreshold: 40, // minimum width for text to display
  expertCount: 16        // default expert count, can be changed via setExpertCount
};

// set the expert count for the model
export function setExpertCount(count) {
  config.expertCount = count;
  return config.expertCount;
}

export function initVisualization() {
  margin = { top: 40, right: 30, bottom: 60, left: 60 };
  width = 900 - margin.left - margin.right;
  height = 500 - margin.top - margin.bottom;

  // Clear existing content
  const container = document.getElementById('container');
  container.innerHTML = '';
  
  // Create the chart title (fixed)
  const chartTitle = document.createElement('div');
  chartTitle.className = 'chart-title';
  chartTitle.innerHTML = '<span>Distribution of Tokens by Expert ID</span>';
  container.appendChild(chartTitle);
  
  // Create the scrollable container
  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'chart-scroll-container';
  container.appendChild(scrollContainer);
  
  // Create new SVG inside the scroll container
  svg = d3.create("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);
  
  // Add a group element for chart content
  g = svg.append("g")
    .attr("transform", `translate(${margin.left}, ${margin.top})`);
  
  // Append SVG to scroll container
  scrollContainer.appendChild(svg.node());
  
  // Create x-axis label (fixed)
  const xAxisLabel = document.createElement('div');
  xAxisLabel.className = 'axis-label';
  xAxisLabel.innerHTML = '<span>Expert ID</span>';
  container.appendChild(xAxisLabel);
  
  // Setup scrollable container based on expert count
  setupScrollableContainer(config.expertCount);
  
  // Draw empty visualization
  drawEmptyVisualization();

  return { svg, g, width, height, margin };
}

// set up the container for scrolling based on expert count
function setupScrollableContainer(expertCount) {
  // calculate required width for all experts
  const calculatedWidth = width / expertCount * (1 - config.expertPadding);
  const blockWidth = Math.max(calculatedWidth, config.minBlockWidth);
  const totalWidth = blockWidth * expertCount * (1 / (1 - config.expertPadding));
  const needsScrolling = totalWidth > width;
  
  if (needsScrolling) {
    // Set SVG width to accommodate all experts
    svg.attr("width", totalWidth + margin.left + margin.right);
    
    // Add scroll indicator if doesn't exist
    const container = document.getElementById('container');
    if (!container.querySelector('.scroll-indicator')) {
      const indicator = document.createElement('div');
      indicator.className = 'scroll-indicator';
      indicator.textContent = '↔️ Scroll to see all experts';
      container.querySelector('.chart-scroll-container').appendChild(indicator);
      
      setTimeout(() => {
        indicator.style.opacity = '0';
        indicator.style.transition = 'opacity 1s';
      }, 5000);
    }
  }
}

function drawEmptyVisualization() {
  const expertIds = Array.from({ length: config.expertCount }, (_, i) => i);
  const calculatedWidth = width / expertIds.length * (1 - config.expertPadding);
  const blockWidth = Math.max(calculatedWidth, config.minBlockWidth);
  const totalWidth = blockWidth * expertIds.length * (1 / (1 - config.expertPadding));
  const actualWidth = Math.max(width, totalWidth);
  
  // x-scale for expert_ids
  const x = d3.scaleBand()
    .domain(expertIds.map(String))
    .range([0, actualWidth])
    .padding(config.expertPadding);
  
  // y-scale for empty visualization
  const y = d3.scaleLinear()
    .domain([0, 10])
    .range([height, 0]);
  
  // x-axis
  g.append("g")
    .attr("transform", `translate(0, ${height})`)
    .call(d3.axisBottom(x).tickFormat(d => d))
    .selectAll("text")
    .style("text-anchor", "middle");
  
  // empty state message (centered in chart area)
  g.append("text")
    .attr("x", actualWidth / 2)
    .attr("y", height / 2)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .style("font-size", "16px")
    .style("fill", "white")
    .style("opacity", "0.7")
    .text("Enter a prompt to see expert routing visualization");
}

export function clearVisualization() {
  console.log('Clearing visualization');
  
  // Reset title text
  const chartTitle = document.querySelector('.chart-title span');
  if (chartTitle) {
    chartTitle.textContent = "Distribution of Tokens by Expert ID";
  }
  
  // Remove legend if it exists
  d3.select('.color-legend-container').remove();
  
  // If we have an SVG and group, clear the group contents
  if (svg && g) {
    g.selectAll("*").remove();
    // Redraw the empty visualization
    drawEmptyVisualization();
  } else {
    // If there's no SVG or group, reinitialize everything
    const { svg: newSvg, g: newG } = initVisualization();
    svg = newSvg;
    g = newG;
  }
}

// Global variable for showing token IDs vs decoded text
let showTokenIds = false;

// Function to update the showTokenIds value from main.js
export function setShowTokenIds(value) {
  showTokenIds = value;
}

export function createVisualization(data) {
  console.log('Creating visualization with data:', data.length);
  
  // initialize if not already done
  if (!svg || !g) {
    const initialized = initVisualization();
    svg = initialized.svg;
    g = initialized.g;
    width = initialized.width;
    height = initialized.height;
    margin = initialized.margin;
  } else {
    // clear existing visualization elements but keep the SVG
    g.selectAll("*").remove();
  }
  
  // ensure we have data
  if (!data || data.length === 0) {
    drawEmptyVisualization();
    return;
  }
  
  // use predefined expert count from config rather than just data
  const expertIds = Array.from({ length: config.expertCount }, (_, i) => i);
  const calculatedWidth = width / expertIds.length * (1 - config.expertPadding);
  const blockWidth = Math.max(calculatedWidth, config.minBlockWidth);
  const totalWidth = blockWidth * expertIds.length * (1 / (1 - config.expertPadding));
  const actualWidth = Math.max(width, totalWidth);
  
  // x-scale for expert_ids
  const x = d3.scaleBand()
    .domain(expertIds.map(String))
    .range([0, actualWidth])
    .padding(config.expertPadding);
  
  // group data by expert_id
  const expertGroups = d3.group(data, d => d.expert_id);
  
  // maximum count for y-scale
  const expertCounts = {};
  expertIds.forEach(id => {
    const group = expertGroups.get(id) || [];
    expertCounts[id] = group.length;
  });
  
  const maxCount = Math.max(...Object.values(expertCounts), 1); // Ensure at least 1 for empty counts
  
  // y-scale for blocks
  const y = d3.scaleLinear()
    .domain([0, maxCount])
    .range([height, 0]);
  
  // Use fixed color scale to match the token display
  const MAX_TOKENS = 150; // Same fixed max as in main.js
  const colorScale = d3.scaleSequential(d3.interpolateViridis)
    .domain([0, MAX_TOKENS]); // Fixed domain for consistency with token display
  
  // draw visualization for each expert_id
  expertIds.forEach(expertId => {
    const group = expertGroups.get(expertId) || [];
    const xPos = x(String(expertId));
    
    // sort by token_pos
    group.sort((a, b) => a.token_pos - b.token_pos);
    
    // vertically stacked blocks
    group.forEach((d, i) => {
      // create block
      const block = g.append("rect")
        .attr("x", xPos)
        .attr("y", height - (i + 1) * config.blockHeight)
        .attr("width", blockWidth)
        .attr("height", config.blockHeight - 2) // small gap between blocks
        .attr("fill", colorScale(d.token_pos))
        .attr("stroke-width", 1)
        .attr("rx", 2)
        .attr("ry", 2)
        .attr("class", "token-block")
        .attr("data-token-pos", d.token_pos);
      
      // Add mouseover/mouseout interactions to highlight corresponding token in the display
      block.on("mouseover", function() {
        // Highlight this block
        d3.select(this).attr("stroke", "#fff").attr("stroke-width", 2);
        
        // Highlight corresponding token in the token display
        try {
          const tokenElem = document.getElementById(`token-${d.token_pos}`);
          if (tokenElem) {
            tokenElem.style.boxShadow = "0 0 5px 2px white";
            tokenElem.style.zIndex = "10";
            tokenElem.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } catch (error) {
          console.warn(`Could not highlight token for position ${d.token_pos}:`, error);
        }
      })
      .on("mouseout", function() {
        // Unhighlight this block
        d3.select(this).attr("stroke", null).attr("stroke-width", 1);
        
        // Unhighlight token
        try {
          const tokenElem = document.getElementById(`token-${d.token_pos}`);
          if (tokenElem) {
            tokenElem.style.boxShadow = "";
            tokenElem.style.zIndex = "";
          }
        } catch (error) {
          console.warn(`Could not unhighlight token for position ${d.token_pos}:`, error);
        }
      });
      
      // tooltip with detailed info
      const tooltipText = d.decoded_token ? 
        `Token: "${d.decoded_token}", ID: ${d.token_id}, Expert: ${d.expert_id}, Position: ${d.token_pos}` :
        `Token ID: ${d.token_id}, Expert ID: ${d.expert_id}, Position: ${d.token_pos}, Layer: ${d.layer_id}`;
        
      block.append("title").text(tooltipText);
      
      // token_id text (only if block is wide enough)
      // Choose what to display based on showTokenIds setting
      let displayText = showTokenIds ? 
        String(d.token_id) : 
        (d.decoded_token ? d.decoded_token : String(d.token_id));
      
      if (blockWidth >= config.textSizeThreshold) {
        // full-sized text for larger blocks
        g.append("text")
          .attr("x", xPos + blockWidth / 2)
          .attr("y", height - (i + 0.5) * config.blockHeight)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("class", "token-text")
          .attr("data-token-pos", d.token_pos)
          .style("font-size", "12px")
          .style("fill", "white")
          .style("font-weight", "bold")
          .text(displayText);
      } else if (blockWidth >= 25) {
        // For medium blocks, show abbreviated text
        const abbrevText = displayText.length > 3 ? 
          displayText.substring(0, 3) + "…" : 
          displayText;
          
        g.append("text")
          .attr("x", xPos + blockWidth / 2)
          .attr("y", height - (i + 0.5) * config.blockHeight)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("class", "token-text")
          .attr("data-token-pos", d.token_pos)
          .style("font-size", "10px") // Smaller font
          .style("fill", "white")
          .style("font-weight", "bold")
          .text(abbrevText);
      }
    });
    
    // count labels
    g.append("text")
      .attr("x", xPos + blockWidth / 2)
      .attr("y", 30)
      .attr("text-anchor", "middle")
      .style("font-size", "12px")
      .style("fill", "white")
      .text(group.length);
  });
  
  // x-axis
  g.append("g")
    .attr("transform", `translate(0, ${height})`)
    .call(d3.axisBottom(x).tickFormat(d => d))
    .selectAll("text")
    .style("text-anchor", "middle");
  
  // Update chart title text for populated state
  const chartTitle = document.querySelector('.chart-title span');
  if (chartTitle) {
    chartTitle.textContent = "Distribution of Token IDs by Expert ID";
  }
  
  // only create color legend if we have data
  if (data.length > 0) {
    // Remove existing legend if present
    d3.select('.color-legend-container').remove();
    
    // Create a fixed position legend container
    const container = document.getElementById('container');
    const legendContainer = document.createElement('div');
    legendContainer.className = 'color-legend-container';
    legendContainer.style.position = 'absolute';
    legendContainer.style.top = '10px';
    legendContainer.style.right = '10px';
    legendContainer.style.width = '200px';
    legendContainer.style.height = '50px';
    legendContainer.style.pointerEvents = 'none';
    container.appendChild(legendContainer);
    
    // Create SVG for legend
    const legendWidth = 200;
    const legendHeight = 15;
    const legendSvg = d3.create("svg")
      .attr("width", legendWidth)
      .attr("height", 50);
    
    // Add to the legend container
    legendContainer.appendChild(legendSvg.node());
    
    const legend = legendSvg.append("g")
      .attr("transform", "translate(0, 5)");
    
    // gradient for legend
    const defs = legendSvg.append("defs");
    const linearGradient = defs.append("linearGradient")
      .attr("id", "token-color-gradient")
      .attr("x1", "0%")
      .attr("x2", "100%")
      .attr("y1", "0%")
      .attr("y2", "0%");
    
    // color stops
    const colorRange = d3.range(0, 1.01, 0.1);
    colorRange.forEach(value => {
      linearGradient.append("stop")
        .attr("offset", `${value * 100}%`)
        .attr("stop-color", colorScale(value * MAX_TOKENS)); // Use the same MAX_TOKENS
    });
    
    // legend rectangle
    legend.append("rect")
      .attr("width", legendWidth)
      .attr("height", legendHeight)
      .style("fill", "url(#token-color-gradient)");
    
    // legend scale - use the fixed MAX_TOKENS value
    const legendScale = d3.scaleLinear()
      .domain([0, MAX_TOKENS])
      .range([0, legendWidth]);
    
    legend.append("g")
      .attr("transform", `translate(0, ${legendHeight})`)
      .call(d3.axisBottom(legendScale).ticks(5));
    
    legend.append("text")
      .attr("x", legendWidth / 2)
      .attr("y", legendHeight + 25)
      .attr("text-anchor", "middle")
      .style("font-size", "10px")
      .style("fill", "white")
      .text("Token Position");
  }
}