import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
  
  const container = document.getElementById('container');
  
  const width = 640;
  const height = 400;
  const marginTop = 20;
  const marginRight = 20;
  const marginBottom = 30;
  const marginLeft = 40;

  // declare the x scale
  const x = d3.scaleUtc()
    .domain([new Date("2023-01-01"), new Date("2024-01-01")])
    .range([marginLeft, width - marginRight]);

  // declare the y scale.
  const y = d3.scaleLinear()
    .domain([0, 100])
    .range([height - marginBottom, marginTop]);

  const svg = d3.create("svg")
    .attr("width", width)
    .attr("height", height);

  // add the x-axis
  svg.append("g")
    .attr("transform", `translate(0,${height - marginBottom})`)
    .call(d3.axisBottom(x));

  // add the y-axis
  svg.append("g")
    .attr("transform", `translate(${marginLeft},0)`)
    .call(d3.axisLeft(y));

  container.append(svg.node());
});