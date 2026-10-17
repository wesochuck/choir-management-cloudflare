import { coverImageOverflow, shiftCoverImagePosition } from "@choir/domain";
import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

interface Position {
  readonly x: number;
  readonly y: number;
}
export function HeroImagePositionEditor({
  imageUrl,
  position,
  disabled,
  onChange,
}: {
  readonly imageUrl: string;
  readonly position: Position;
  readonly disabled: boolean;
  readonly onChange: (next: Position) => void;
}) {
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [size, setSize] = useState({ width: 0, height: 0, src: "" });
  const drag = useRef<{
    pointerId: number;
    start: Position;
    client: Position;
    overflow: Position;
  } | null>(null);
  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || size.src !== imageUrl) return;
    const box = event.currentTarget.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      start: position,
      client: { x: event.clientX, y: event.clientY },
      overflow: coverImageOverflow(size.width, size.height, box.width, box.height),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    onChange(
      shiftCoverImagePosition(
        current.start,
        { x: event.clientX - current.client.x, y: event.clientY - current.client.y },
        current.overflow,
      ),
    );
  }
  function moveKey(event: KeyboardEvent<HTMLButtonElement>) {
    const delta: Readonly<Record<string, Position>> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const offset = delta[event.key];
    if (!offset) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    onChange({
      x: Math.min(100, Math.max(0, position.x + offset.x * step)),
      y: Math.min(100, Math.max(0, position.y + offset.y * step)),
    });
  }
  return (
    <fieldset className="hero-position-editor form-stack" disabled={disabled}>
      <legend>Reposition hero image</legend>
      <div className="segmented-control" role="group" aria-label="Image crop preview">
        {(["desktop", "mobile"] as const).map((device) => (
          <button
            type="button"
            className={`button button--sm ${viewport === device ? "button--primary" : "button--secondary"}`}
            aria-pressed={viewport === device}
            key={device}
            onClick={() => {
              setViewport(device);
            }}
          >
            {device === "desktop" ? "Desktop crop" : "Mobile crop"}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`hero-position-editor__image hero-position-editor__image--${viewport}`}
        aria-label="Reposition hero image"
        aria-describedby="hero-position-instructions"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={moveKey}
        style={{
          backgroundImage: `url(${imageUrl})`,
          backgroundPosition: `${String(position.x)}% ${String(position.y)}%`,
        }}
      >
        <img
          alt=""
          aria-hidden="true"
          draggable={false}
          src={imageUrl}
          onLoad={(event) => {
            setSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
              src: imageUrl,
            });
          }}
        />
        <span>Drag to reposition</span>
      </button>
      <p className="field-help" id="hero-position-instructions">
        Drag the image, use the arrow keys, or adjust the sliders. Check both crops: one position is
        used across screen sizes. Save and publish to update your website.
      </p>
      <div className="form-grid">
        <label className="field">
          Horizontal focal point: {Math.round(position.x)}%
          <input
            type="range"
            min={0}
            max={100}
            value={position.x}
            onChange={(event) => {
              onChange({ ...position, x: Number(event.target.value) });
            }}
          />
        </label>
        <label className="field">
          Vertical focal point: {Math.round(position.y)}%
          <input
            type="range"
            min={0}
            max={100}
            value={position.y}
            onChange={(event) => {
              onChange({ ...position, y: Number(event.target.value) });
            }}
          />
        </label>
      </div>
      <button
        type="button"
        className="button button--secondary"
        onClick={() => {
          onChange({ x: 50, y: 50 });
        }}
      >
        Center image
      </button>
    </fieldset>
  );
}
