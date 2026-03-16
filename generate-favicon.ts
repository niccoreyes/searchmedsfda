/**
 * Generate PNG favicon from SVG logo
 * Run with: bun generate-favicon.ts
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <rect width="24" height="24" rx="4" fill="#0f766e"/>
  <path d="M8 21h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z" stroke="white" stroke-width="2"/>
  <path d="M12 11v6M9 14h6" stroke="white" stroke-width="2"/>
</svg>`;

const sizes = [16, 32, 48];

async function generateFavicon() {
  for (const size of sizes) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Fill background
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, size, size);
    
    // Draw the icon paths (simplified version)
    ctx.strokeStyle = 'white';
    ctx.lineWidth = size / 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Outer rectangle (pill shape)
    const padding = size * 0.2;
    const iconWidth = size - padding * 2;
    const iconHeight = size - padding * 2;
    
    ctx.strokeRect(padding, padding, iconWidth, iconHeight);
    
    // Plus sign inside
    const centerX = size / 2;
    const centerY = size / 2;
    const plusSize = iconWidth * 0.4;
    
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - plusSize / 2);
    ctx.lineTo(centerX, centerY + plusSize / 2);
    ctx.stroke();
    
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(centerX - plusSize / 2, centerY);
    ctx.lineTo(centerX + plusSize / 2, centerY);
    ctx.stroke();
    
    const filename = size === 32 ? 'favicon.png' : `favicon-${size}x${size}.png`;
    const buffer = canvas.toBuffer('image/png');
    writeFileSync(filename, buffer);
    console.log(`Generated ${filename}`);
  }
  
  console.log('Favicon generation complete!');
}

generateFavicon().catch(console.error);
