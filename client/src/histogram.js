import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// generate sample data
function generateData() {
  return Array.from({ length: 64 }, () => ({
    layer_id: Math.floor(Math.random() * 12),
    token_id: Math.floor(Math.random() * 1000),
    expert_id: Math.floor(Math.random() * 16 + 1),
    token_pos: Math.floor(Math.random() * 128)
  }));
}

// Initialize the visualization
export function initVisualization() {
  margin = { top: 40, right: 30, bottom: 60, left: 60 };
  width = 900 - margin.left - margin.right;
  height = 500 - margin.top - margin.bottom;

  // Remove any existing SVG
  d3.select('#container svg').remove();

  // Create new SVG
  svg = d3.create("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);
  
  // Add a group element for margin handling
  g = svg.append("g")
    .attr("transform", `translate(${margin.left}, ${margin.top})`);
  
  // Get the container and append the SVG
  const container = document.getElementById('container');
  container.append(svg.node());

  return { svg, g, width, height, margin };
}

// Clear the visualization
export function clearVisualization() {
  d3.select('#container svg').remove();
  const { svg: newSvg, g: newG } = initVisualization();
  svg = newSvg;
  g = newG;
}

// create visualization
export function createVisualization(data, svg, g, width, height, margin) {
  
  const expertGroups = d3.group(data, d => d.expert_id);
  const expertIds = Array.from({ length: 16 }, (_, i) => i + 1);
  
  // x-scale for expert_ids
  const x = d3.scaleBand()
    .domain(expertIds.map(String))
    .range([0, width])
    .padding(0.2);
  
  // maximum count for y-scale
  const expertCounts = {};
  expertIds.forEach(id => {
    const group = expertGroups.get(id) || [];
    expertCounts[id] = group.length;
  });
  
  const maxCount = Math.max(...Object.values(expertCounts));
  
  // y-scale for blocks
  const y = d3.scaleLinear()
    .domain([0, maxCount])
    .range([height, 0]);
  
  // block dimensions
  const blockWidth = x.bandwidth();
  const blockHeight = 20;  // fixed height for each block
  
  // color scale based on token_pos values
  const colorScale = d3.scaleSequential(d3.interpolateViridis)
    .domain([0, d3.max(data, d => d.token_pos)]);
  
  // draw blocks for each expert_id
  expertIds.forEach(expertId => {
    const group = expertGroups.get(expertId) || [];
    const xPos = x(String(expertId));
    
    // sort by token_pos
    group.sort((a, b) => a.token_pos - b.token_pos);
    
    // vertically stacked blocks
    group.forEach((d, i) => {
      
      g.append("rect")
        .attr("x", xPos)
        .attr("y", height - (i + 1) * blockHeight)
        .attr("width", blockWidth)
        .attr("height", blockHeight - 2) // small gap between blocks
        .attr("fill", colorScale(d.token_pos))
        // .attr("stroke", "#fff")
        .attr("stroke-width", 1)
        .attr("rx", 2)
        .attr("ry", 2)
        .append("title")
        .text(`Token ID: ${d.token_id}, Expert ID: ${d.expert_id}, Position: ${d.token_pos}`);
      
      // token_id text
      g.append("text")
        .attr("x", xPos + blockWidth / 2)
        .attr("y", height - (i + 0.5) * blockHeight)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .style("font-size", "12px")
        .style("fill", "white")
        .style("font-weight", "bold")
        .text(d.token_id);
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
    .attr("x", width / 2)
    .attr("y", height + margin.bottom - 15)
    .attr("text-anchor", "middle")
    .style("fill", "white")
    .text("Expert ID");
  
  // title
  g.append("text")
    .attr("x", width / 2)
    .attr("y", -margin.top / 2)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("fill", "white")
    .text("Distribution of Token IDs by Expert ID");
  
  // color legend
  const legendWidth = 200;
  const legendHeight = 15;
  
  const legend = g.append("g")
    .attr("transform", `translate(${width - legendWidth}, ${-margin.top})`);
  
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

// wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
  const margin = { top: 40, right: 30, bottom: 60, left: 60 };
  const width = 900 - margin.left - margin.right;
  const height = 500 - margin.top - margin.bottom;

  const svg = d3.create("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);
  
  // add a group element for margin handling
  const g = svg.append("g")
    .attr("transform", `translate(${margin.left}, ${margin.top})`);
  
  // get the container and append the SVG
  const container = document.getElementById('container');
  container.append(svg.node());

  // generate sample data and create visualization
  const sampleData = generateData();
  createVisualization(sampleData, svg, g, width, height, margin);
});