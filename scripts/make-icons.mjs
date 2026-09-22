import sharp from "sharp";
import { brand } from "../lib/brand.ts";

const mark = (size) => {
  const radius = size * 0.18;
  const centerY = size / 2;
  const centerOffset = size * 0.12;
  const centerX = size / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${brand.background.light}"/>
  <circle cx="${centerX - centerOffset}" cy="${centerY}" r="${radius}" fill="${brand.me}"/>
  <circle cx="${centerX + centerOffset}" cy="${centerY}" r="${radius}" fill="${brand.partner}" fill-opacity="0.85"/>
</svg>`;
};

await sharp(Buffer.from(mark(512))).png().toFile("app/icon.png");
await sharp(Buffer.from(mark(180))).png().removeAlpha().toFile("app/apple-icon.png");
