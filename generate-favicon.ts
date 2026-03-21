/**
 * Generate PNG favicons and PWA icons from SVG logo
 * Run with: bun generate-favicon.ts
 */

import { createCanvas, CanvasRenderingContext2D } from 'canvas';
import { writeFileSync } from 'fs';

// Standard icon sizes (favicons and PWA icons)
const faviconSizes = [16, 32, 48];
const pwaSizes = [192, 512];
const maskableSizes = [192, 512];

function drawIcon(ctx: CanvasRenderingContext2D, size: number, padding: number) {
  ctx.strokeStyle = 'white';
  ctx.lineWidth = size / 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Outer rectangle (pill shape)
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
}

async function generateFavicon() {
  // Generate favicon sizes (for browser tabs)
  for (const size of faviconSizes) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, size, size);

    // Draw icon with standard padding
    const padding = size * 0.2;
    drawIcon(ctx, size, padding);

    const filename = size === 32 ? 'favicon.png' : `favicon-${size}x${size}.png`;
    const buffer = canvas.toBuffer('image/png');
    writeFileSync(filename, buffer);
    console.log(`Generated ${filename}`);
  }

  // Generate PWA icon sizes
  for (const size of pwaSizes) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Fill background with rounded corners (simulated)
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, size, size);

    // Draw icon with standard padding
    const padding = size * 0.15;
    drawIcon(ctx, size, padding);

    const filename = `icon-${size}x${size}.png`;
    const buffer = canvas.toBuffer('image/png');
    writeFileSync(filename, buffer);
    console.log(`Generated ${filename}`);
  }

  // Generate maskable icons (more padding for Android adaptive icons)
  for (const size of maskableSizes) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, size, size);

    // Draw icon with larger padding (maskable safe zone is 80% of icon)
    const padding = size * 0.25;
    drawIcon(ctx, size, padding);

    const filename = `icon-maskable-${size}x${size}.png`;
    const buffer = canvas.toBuffer('image/png');
    writeFileSync(filename, buffer);
    console.log(`Generated ${filename}`);
  }

  console.log('\nAll icons generated successfully!');
  console.log('Favicons: favicon.png, favicon-16x16.png, favicon-48x48.png');
  console.log('PWA Icons: icon-192x192.png, icon-512x512.png');
  console.log('Maskable Icons: icon-maskable-192x192.png, icon-maskable-512x512.png');
}

generateFavicon().catch(console.error);
