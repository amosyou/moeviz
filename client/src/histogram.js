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

  d3.select('#container svg').remove();

  svg = d3.create("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);
  
  // add a group element for margin handling
  g = svg.append("g")
    .attr("transform", `translate(${margin.left}, ${margin.top})`);
  
  // get container and append SVG
  const container = document.getElementById('container');
  container.append(svg.node());
  
  // set up container for horizontal scrolling if needed
  setupScrollableContainer(config.expertCount);
  
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
    svg.attr("width", totalWidth + margin.left + margin.right);
    
    const container = document.getElementById('container');
    container.style.overflowX = "auto";
    container.style.overflowY = "hidden";
    
    if (!document.querySelector('.scroll-indicator')) {
      const indicator = document.createElement('div');
      indicator.className = 'scroll-indicator';
      indicator.textContent = '↔️ Scroll to see all experts';
      container.appendChild(indicator);
      
      setTimeout(() => {
        indicator.style.opacity = '0';
        indicator.style.transition = 'opacity 1s';
      }, 5000);
    }
  }
}

function drawEmptyVisualization() {
  const expertIds = Array.from({ length: config.expertCount }, (_, i) => i + 1);
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
  
  // x-axis label
  g.append("text")
    .attr("x", Math.min(width, actualWidth) / 2)
    .attr("y", height + margin.bottom - 15)
    .attr("text-anchor", "middle")
    .style("fill", "white")
    .text("Expert ID");
  
  // title
  g.append("text")
    .attr("x", Math.min(width, actualWidth) / 2)
    .attr("y", -margin.top / 2)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("fill", "white")
    .text("Distribution of Token IDs by Expert ID");
    
  // empty state message
  g.append("text")
    .attr("x", Math.min(width, actualWidth) / 2)
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
  d3.select('#container svg').remove();
  const { svg: newSvg, g: newG } = initVisualization();
  svg = newSvg;
  g = newG;
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
  const expertIds = Array.from({ length: config.expertCount }, (_, i) => i + 1);
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
  
  // color scale based on token_pos values
  const colorScale = d3.scaleSequential(d3.interpolateViridis)
    .domain([0, d3.max(data, d => d.token_pos) || 1]); // Ensure valid domain even with no data
  
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
      let displayText = d.decoded_token ? d.decoded_token : String(d.token_id);
      
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
  
  // x-axis label
  g.append("text")
    .attr("x", Math.min(width, actualWidth) / 2)
    .attr("y", height + margin.bottom - 15)
    .attr("text-anchor", "middle")
    .style("fill", "white")
    .text("Expert ID");
  
  // title
  g.append("text")
    .attr("x", Math.min(width, actualWidth) / 2)
    .attr("y", -margin.top / 2)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("fill", "white")
    .text("Distribution of Token IDs by Expert ID");
  
  // only create color legend if we have data
  if (data.length > 0) {
    // color legend
    const legendWidth = 200;
    const legendHeight = 15;
    
    const legend = g.append("g")
      .attr("transform", `translate(${Math.min(width, actualWidth) - legendWidth - 10}, ${-margin.top})`);
    
    // gradient for legend
    const defs = g.append("defs");
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
        .attr("stop-color", colorScale(value * d3.max(data, d => d.token_pos)));
    });
    
    // legend rectangle
    legend.append("rect")
      .attr("width", legendWidth)
      .attr("height", legendHeight)
      .style("fill", "url(#token-color-gradient)");
    
    // legend scale
    const legendScale = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.token_pos)])
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