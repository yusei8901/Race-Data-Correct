import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
export type BboxTool = "select" | "add_bbox" | "reference_line" | "fence_marker";

export interface BboxItem {
  id: string;
  x: number; y: number; w: number; h: number;
  cap_class: string;  // e.g. "class_white"
  cap_color_key: number; // gate number 1-8
}

export interface RefLine {
  x1: number; y1: number; x2: number; y2: number;
}

export interface FenceMarker {
  x: number; y: number;
}

export interface BboxAnnotation {
  bboxes: BboxItem[];
  reference_line: RefLine | null;
  fence_markers: FenceMarker[];
}

interface BboxCanvasProps {
  tool: BboxTool;
  annotation: BboxAnnotation;
  selectedId: string | null;
  onAnnotationChange: (a: BboxAnnotation) => void;
  onSelectId: (id: string | null) => void;
  newCapClass: string;
  newCapColorKey: number;
  disabled?: boolean;
}

export interface BboxCanvasHandle {
  redraw: () => void;
}

// ── CAP color map (gate 1–8) ──────────────────────────────────────────────────
const CAP_STROKE: Record<number, string> = {
  1: "#ffffff", 2: "#888888", 3: "#ef4444",
  4: "#3b82f6", 5: "#facc15", 6: "#22c55e",
  7: "#f97316", 8: "#ec4899",
};

const HANDLE_R = 6;
const SNAP_R = 12; // px, hit-test radius

// ── Geometry helpers ──────────────────────────────────────────────────────────
function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

/** Extend a line through (x1,y1)→(x2,y2) to canvas boundaries */
function extendLine(x1: number, y1: number, x2: number, y2: number, W: number, H: number) {
  const dx = x2 - x1; const dy = y2 - y1;
  if (dx === 0 && dy === 0) return { ax: x1, ay: y1, bx: x2, by: y2 };
  const ts: number[] = [];
  if (dx !== 0) { ts.push(-x1 / dx); ts.push((W - x1) / dx); }
  if (dy !== 0) { ts.push(-y1 / dy); ts.push((H - y1) / dy); }
  ts.sort((a, b) => a - b);
  return {
    ax: x1 + ts[0] * dx, ay: y1 + ts[0] * dy,
    bx: x1 + ts[ts.length - 1] * dx, by: y1 + ts[ts.length - 1] * dy,
  };
}

/** Compute perpendicular foot of point (px,py) onto segment (x1,y1)-(x2,y2) */
function perpFoot(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1; const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { fx: x1, fy: y1 };
  const t = ((px - x1) * dx + (py - y1) * dy) / len2;
  return { fx: x1 + t * dx, fy: y1 + t * dy };
}

// ── Draw ─────────────────────────────────────────────────────────────────────
function drawAll(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  annotation: BboxAnnotation,
  selectedId: string | null,
) {
  ctx.clearRect(0, 0, W, H);

  const { bboxes, reference_line: rl, fence_markers: fm } = annotation;

  // Fence markers: orange dots + connecting polyline
  if (fm.length > 0) {
    ctx.save();
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    fm.forEach((m, i) => {
      const mx = m.x * W; const my = m.y * H;
      if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    fm.forEach((m) => {
      const mx = m.x * W; const my = m.y * H;
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#f97316";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.restore();
  }

  // Reference line: bright yellow extended to canvas edges
  if (rl) {
    const x1 = rl.x1 * W; const y1 = rl.y1 * H;
    const x2 = rl.x2 * W; const y2 = rl.y2 * H;
    const { ax, ay, bx, by } = extendLine(x1, y1, x2, y2, W, H);
    ctx.save();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    // Endpoint handles
    [[x1, y1], [x2, y2]].forEach(([ex, ey]) => {
      ctx.beginPath(); ctx.arc(ex, ey, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = "#facc15"; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
    });
    // Debug: show perpendicular lines from each bbox center to the reference line
    bboxes.forEach((b) => {
      const cx = (b.x + b.w / 2) * W;
      const cy = (b.y + b.h / 2) * H;
      const { fx, fy } = perpFoot(cx, cy, x1, y1, x2, y2);
      ctx.strokeStyle = "rgba(250,204,21,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();
  }

  // BBOXes
  bboxes.forEach((b) => {
    const bx = b.x * W; const by = b.y * H;
    const bw = b.w * W; const bh = b.h * H;
    const stroke = CAP_STROKE[b.cap_color_key] ?? "#ffffff";
    const isSelected = b.id === selectedId;

    ctx.save();
    ctx.strokeStyle = isSelected ? "#00e5ff" : stroke;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.strokeRect(bx, by, bw, bh);

    // Fill with translucent cap color
    ctx.fillStyle = stroke + "22";
    ctx.fillRect(bx, by, bw, bh);

    // Label top-left
    ctx.fillStyle = isSelected ? "#00e5ff" : stroke;
    ctx.font = "bold 10px monospace";
    ctx.fillText(b.cap_class.replace("class_", ""), bx + 3, by + 11);

    // Resize handles (corners) when selected
    if (isSelected) {
      [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]].forEach(([hx, hy]) => {
        ctx.beginPath(); ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
        ctx.fillStyle = "#00e5ff"; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
      });
    }
    ctx.restore();
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
const BboxCanvas = forwardRef<BboxCanvasHandle, BboxCanvasProps>(function BboxCanvas(
  { tool, annotation, selectedId, onAnnotationChange, onSelectId, newCapClass, newCapColorKey, disabled = false },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Drag state kept in ref for performance (no re-render during drag)
  const dragRef = useRef<{
    type: "move" | "resize" | "add_bbox" | "reference_line_p1" | "reference_line_p2" | "fence_marker" | null;
    bboxId?: string;
    corner?: number; // 0=TL,1=TR,2=BL,3=BR
    startX: number; startY: number;
    lastX: number; lastY: number;
    // For add_bbox: rect being drawn
    drawRect?: { x: number; y: number; w: number; h: number };
    // For reference_line: first point
    lineP1?: { x: number; y: number };
    // Current working annotation (mutated during drag for canvas redraw)
    workAnnotation: BboxAnnotation;
  } | null>(null);

  const annotationRef = useRef(annotation);
  annotationRef.current = annotation;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width; const H = canvas.height;
    const ann = dragRef.current ? dragRef.current.workAnnotation : annotationRef.current;
    drawAll(ctx, W, H, ann, selectedIdRef.current);
  }, []);

  useImperativeHandle(ref, () => ({ redraw }), [redraw]);

  // Sync size to parent
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      redraw();
    });
    ro.observe(parent);
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    redraw();
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(() => { redraw(); }, [annotation, selectedId, redraw]);

  // ── Hit tests ──────────────────────────────────────────────────────────────
  function hitHandle(px: number, py: number, bx: number, by: number, bw: number, bh: number) {
    const corners = [
      { x: bx, y: by, c: 0 }, { x: bx + bw, y: by, c: 1 },
      { x: bx, y: by + bh, c: 2 }, { x: bx + bw, y: by + bh, c: 3 },
    ];
    for (const co of corners) {
      if (dist(px, py, co.x, co.y) <= SNAP_R) return co.c;
    }
    return -1;
  }

  function hitBbox(px: number, py: number, W: number, H: number): string | null {
    const bboxes = annotationRef.current.bboxes;
    for (let i = bboxes.length - 1; i >= 0; i--) {
      const b = bboxes[i];
      if (px >= b.x * W && px <= (b.x + b.w) * W && py >= b.y * H && py <= (b.y + b.h) * H) {
        return b.id;
      }
    }
    return null;
  }

  function hitRefLineEndpoint(px: number, py: number, W: number, H: number): 1 | 2 | null {
    const rl = annotationRef.current.reference_line;
    if (!rl) return null;
    if (dist(px, py, rl.x1 * W, rl.y1 * H) <= SNAP_R) return 1;
    if (dist(px, py, rl.x2 * W, rl.y2 * H) <= SNAP_R) return 2;
    return null;
  }

  function hitFenceMarker(px: number, py: number, W: number, H: number): number {
    const fm = annotationRef.current.fence_markers;
    for (let i = fm.length - 1; i >= 0; i--) {
      if (dist(px, py, fm[i].x * W, fm[i].y * H) <= SNAP_R) return i;
    }
    return -1;
  }

  // ── Mouse handlers ─────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width; const H = canvas.height;
    const px = e.clientX - rect.left; const py = e.clientY - rect.top;
    const ann = annotationRef.current;
    const selId = selectedIdRef.current;

    if (tool === "select") {
      // Check if clicking a handle of selected bbox first
      if (selId) {
        const b = ann.bboxes.find((b) => b.id === selId);
        if (b) {
          const corner = hitHandle(px, py, b.x * W, b.y * H, b.w * W, b.h * H);
          if (corner >= 0) {
            dragRef.current = {
              type: "resize", bboxId: selId, corner,
              startX: px, startY: py, lastX: px, lastY: py,
              workAnnotation: JSON.parse(JSON.stringify(ann)),
            };
            return;
          }
        }
      }
      // Check ref line endpoint in select mode
      const rlEp = hitRefLineEndpoint(px, py, W, H);
      if (rlEp) {
        dragRef.current = {
          type: rlEp === 1 ? "reference_line_p1" : "reference_line_p2",
          startX: px, startY: py, lastX: px, lastY: py,
          workAnnotation: JSON.parse(JSON.stringify(ann)),
        };
        return;
      }
      // Check fence marker
      const fmIdx = hitFenceMarker(px, py, W, H);
      if (fmIdx >= 0) {
        // Start moving fence marker (treat as "fence_marker" drag)
        const work = JSON.parse(JSON.stringify(ann)) as BboxAnnotation;
        dragRef.current = {
          type: "fence_marker", startX: px, startY: py, lastX: px, lastY: py,
          workAnnotation: work,
        };
        // Store index in corner field
        dragRef.current.corner = fmIdx;
        return;
      }
      // Hit bbox
      const hitId = hitBbox(px, py, W, H);
      onSelectId(hitId);
      if (hitId) {
        dragRef.current = {
          type: "move", bboxId: hitId,
          startX: px, startY: py, lastX: px, lastY: py,
          workAnnotation: JSON.parse(JSON.stringify(ann)),
        };
      }
      return;
    }

    if (tool === "add_bbox") {
      dragRef.current = {
        type: "add_bbox",
        startX: px, startY: py, lastX: px, lastY: py,
        drawRect: { x: px / W, y: py / H, w: 0, h: 0 },
        workAnnotation: JSON.parse(JSON.stringify(ann)),
      };
      return;
    }

    if (tool === "reference_line") {
      const existing = ann.reference_line;
      if (existing) {
        // Click near existing endpoint → move it
        const rlEp = hitRefLineEndpoint(px, py, W, H);
        if (rlEp) {
          dragRef.current = {
            type: rlEp === 1 ? "reference_line_p1" : "reference_line_p2",
            startX: px, startY: py, lastX: px, lastY: py,
            workAnnotation: JSON.parse(JSON.stringify(ann)),
          };
          return;
        }
      }
      // Start drawing new line (or reset)
      dragRef.current = {
        type: "reference_line_p1",
        startX: px, startY: py, lastX: px, lastY: py,
        lineP1: { x: px / W, y: py / H },
        workAnnotation: {
          ...JSON.parse(JSON.stringify(ann)),
          reference_line: { x1: px / W, y1: py / H, x2: px / W, y2: py / H },
        },
      };
      return;
    }

    if (tool === "fence_marker") {
      // Add a new marker
      const work = JSON.parse(JSON.stringify(ann)) as BboxAnnotation;
      work.fence_markers.push({ x: px / W, y: py / H });
      onAnnotationChange(work);
      redraw();
      return;
    }
  }, [tool, onSelectId, onAnnotationChange, redraw]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width; const H = canvas.height;
    const px = e.clientX - rect.left; const py = e.clientY - rect.top;
    const { type, workAnnotation: wa } = dragRef.current;
    const dx = (px - dragRef.current.lastX) / W;
    const dy = (py - dragRef.current.lastY) / H;
    dragRef.current.lastX = px; dragRef.current.lastY = py;

    if (type === "move" && dragRef.current.bboxId) {
      const b = wa.bboxes.find((b) => b.id === dragRef.current!.bboxId);
      if (b) {
        b.x = Math.max(0, Math.min(1 - b.w, b.x + dx));
        b.y = Math.max(0, Math.min(1 - b.h, b.y + dy));
      }
    } else if (type === "resize" && dragRef.current.bboxId) {
      const b = wa.bboxes.find((b) => b.id === dragRef.current!.bboxId);
      if (b) {
        const c = dragRef.current.corner ?? 0;
        if (c === 0) { // TL
          b.x = Math.max(0, Math.min(b.x + b.w - 0.01, b.x + dx));
          b.y = Math.max(0, Math.min(b.y + b.h - 0.01, b.y + dy));
          b.w = Math.max(0.01, b.w - dx); b.h = Math.max(0.01, b.h - dy);
        } else if (c === 1) { // TR
          b.y = Math.max(0, Math.min(b.y + b.h - 0.01, b.y + dy));
          b.w = Math.max(0.01, b.w + dx); b.h = Math.max(0.01, b.h - dy);
        } else if (c === 2) { // BL
          b.x = Math.max(0, Math.min(b.x + b.w - 0.01, b.x + dx));
          b.w = Math.max(0.01, b.w - dx); b.h = Math.max(0.01, b.h + dy);
        } else { // BR
          b.w = Math.max(0.01, b.w + dx); b.h = Math.max(0.01, b.h + dy);
        }
        // Clamp
        b.x = Math.max(0, b.x); b.y = Math.max(0, b.y);
        b.w = Math.min(1 - b.x, b.w); b.h = Math.min(1 - b.y, b.h);
      }
    } else if (type === "add_bbox") {
      const sx = dragRef.current.startX / W; const sy = dragRef.current.startY / H;
      const cx = px / W; const cy = py / H;
      dragRef.current.drawRect = {
        x: Math.min(sx, cx), y: Math.min(sy, cy),
        w: Math.abs(cx - sx), h: Math.abs(cy - sy),
      };
      // Show preview in workAnnotation
      const rect = dragRef.current.drawRect;
      wa.bboxes = [...annotationRef.current.bboxes, {
        id: "__preview__", x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        cap_class: newCapClass, cap_color_key: newCapColorKey,
      }];
    } else if (type === "reference_line_p1" && wa.reference_line) {
      // Drawing new line: p1 is fixed, update p2 to cursor
      wa.reference_line.x2 = px / W; wa.reference_line.y2 = py / H;
    } else if (type === "reference_line_p1" && dragRef.current.lineP1) {
      wa.reference_line = {
        x1: dragRef.current.lineP1.x, y1: dragRef.current.lineP1.y,
        x2: px / W, y2: py / H,
      };
    } else if (type === "reference_line_p2" && wa.reference_line) {
      wa.reference_line.x1 = px / W; wa.reference_line.y1 = py / H;
    } else if (type === "fence_marker" && dragRef.current.corner != null) {
      // Moving existing fence marker
      const idx = dragRef.current.corner;
      if (wa.fence_markers[idx]) {
        wa.fence_markers[idx] = { x: Math.max(0, Math.min(1, px / W)), y: Math.max(0, Math.min(1, py / H)) };
      }
    }

    redraw();
  }, [newCapClass, newCapColorKey, redraw]);

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width; const H = canvas.height;
    const px = e.clientX - rect.left; const py = e.clientY - rect.top;
    const { type, workAnnotation: wa } = dragRef.current;

    if (type === "add_bbox") {
      const dr = dragRef.current.drawRect;
      if (dr && dr.w > 0.005 && dr.h > 0.005) {
        const newBbox: BboxItem = {
          id: crypto.randomUUID(),
          x: dr.x, y: dr.y, w: dr.w, h: dr.h,
          cap_class: newCapClass, cap_color_key: newCapColorKey,
        };
        const newAnn = {
          ...annotationRef.current,
          bboxes: [...annotationRef.current.bboxes, newBbox],
        };
        onAnnotationChange(newAnn);
        onSelectId(newBbox.id);
      }
      dragRef.current = null;
      redraw();
      return;
    }

    if (type === "reference_line_p1" || type === "reference_line_p2") {
      if (wa.reference_line) {
        onAnnotationChange({ ...annotationRef.current, reference_line: wa.reference_line });
      }
      dragRef.current = null;
      redraw();
      return;
    }

    if (type === "move" || type === "resize") {
      onAnnotationChange({ ...wa });
      dragRef.current = null;
      redraw();
      return;
    }

    if (type === "fence_marker") {
      onAnnotationChange({ ...wa });
      dragRef.current = null;
      redraw();
      return;
    }

    dragRef.current = null;
    redraw();
  }, [newCapClass, newCapColorKey, onAnnotationChange, onSelectId, redraw]);

  // Right-click to remove fence marker
  const onContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width; const H = canvas.height;
    const px = e.clientX - rect.left; const py = e.clientY - rect.top;

    if (tool === "fence_marker" || tool === "select") {
      const idx = hitFenceMarker(px, py, W, H);
      if (idx >= 0) {
        const newAnn = { ...annotationRef.current, fence_markers: annotationRef.current.fence_markers.filter((_, i) => i !== idx) };
        onAnnotationChange(newAnn);
        return;
      }
    }
  }, [tool, onAnnotationChange]);

  // Cursor style
  const cursor = disabled ? "default"
    : tool === "add_bbox" ? "crosshair"
    : tool === "reference_line" ? "crosshair"
    : tool === "fence_marker" ? "cell"
    : "default";

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ cursor, zIndex: 10 }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
    />
  );
});

export default BboxCanvas;
