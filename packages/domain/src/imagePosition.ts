export function coverImageOverflow(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
) {
  if (imageWidth <= 0 || imageHeight <= 0) return { x: 0, y: 0 };
  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  return {
    x: Math.max(0, imageWidth * scale - frameWidth),
    y: Math.max(0, imageHeight * scale - frameHeight),
  };
}

export function shiftCoverImagePosition(
  start: { readonly x: number; readonly y: number },
  delta: { readonly x: number; readonly y: number },
  overflow: { readonly x: number; readonly y: number },
) {
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  return {
    x: overflow.x > 0 ? clamp(start.x - (delta.x / overflow.x) * 100) : start.x,
    y: overflow.y > 0 ? clamp(start.y - (delta.y / overflow.y) * 100) : start.y,
  };
}
