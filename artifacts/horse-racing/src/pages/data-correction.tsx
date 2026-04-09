import {
  useState, useMemo, useEffect, useRef, useCallback,
} from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Play, Pause, ChevronFirst, ChevronLast,
  History, CheckCircle2, Save, Clock, Minus, Plus, Ruler,
  ChevronLeft, ChevronRight, Trash2, RefreshCw, Square,
  MousePointer2, AlertTriangle, X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRace, getGetRaceQueryKey,
  useGetRaceEntries, getGetRaceEntriesQueryKey,
  useGetPassingOrders, getGetPassingOrdersQueryKey,
  useStartCorrection, useCompleteCorrection,
} from "@workspace/api-client-react";
import type { Race } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/contexts/user-role";

// ── Constants ──────────────────────────────────────────────────────────────
const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE_URL}/fastapi`;
const FPS = 30;
const VIDEO_OFFSET = 7.30;

const STRAIGHT_MAP: Record<string, number> = {
  "中山芝": 310, "中山ダート": 310,
  "阪神芝": 356, "阪神ダート": 352,
  "東京芝": 502, "東京ダート": 502,
  "京都芝": 404, "京都ダート": 329,
};

const CAP_COLORS: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: "#ffffff", text: "#000", label: "白" },
  2: { bg: "#111111", text: "#fff", label: "黒" },
  3: { bg: "#dc2626", text: "#fff", label: "赤" },
  4: { bg: "#2563eb", text: "#fff", label: "青" },
  5: { bg: "#facc15", text: "#000", label: "黄" },
  6: { bg: "#16a34a", text: "#fff", label: "緑" },
  7: { bg: "#ea580c", text: "#000", label: "橙" },
  8: { bg: "#ec4899", text: "#000", label: "桃" },
};

const SPECIAL_NOTES = ["ー", "出遅れ", "大幅遅れ", "映像見切れ", "確認困難", "他馬と重複", "落馬", "失格"];
const EXEMPT_SPECIAL_NOTES = new Set(["映像見切れ", "確認困難", "他馬と重複", "落馬", "失格"]);
const LANES = ["内", "中", "外"];
const PLAY_SPEEDS = [0.5, 1.0, 1.5, 2.0];
const ANALYSIS_PRESETS = ["標準", "逆光", "曇り", "雨天"] as const;
const VENUE_ID_MAP: Record<string, string> = {
  "中山": "nakayama", "阪神": "hanshin", "京都": "kyoto", "東京": "tokyo",
  "大井": "oi", "川崎": "kawasaki",
};

function formatMargin(margin: number | null | undefined, finishPos: number | null | undefined): string {
  if (finishPos === 1) return "-";
  if (margin == null) return "-";
  if (margin < 0.12) return "ハナ";
  if (margin < 0.28) return "アタマ";
  if (margin < 0.45) return "クビ";
  if (margin < 0.65) return "½";
  if (margin < 0.88) return "¾";
  if (margin < 1.15) return "1";
  if (margin < 1.35) return "1¼";
  if (margin < 1.65) return "1½";
  if (margin < 1.85) return "1¾";
  if (margin < 2.25) return "2";
  if (margin < 2.75) return "2½";
  if (margin < 3.25) return "3";
  if (margin < 3.75) return "3½";
  if (margin < 4.5) return "4";
  if (margin < 5.5) return "5";
  return `${Math.round(margin)}`;
}

// ── Types ──────────────────────────────────────────────────────────────────
interface BBox {
  id: string;
  horseNumber: number | null;
  gateNumber: number | null;
  x: number; y: number; w: number; h: number;
}

type DragHandle = "body" | "tl" | "tr" | "bl" | "br";

type Keyframes = Record<string, Record<number, BBox[]>>;

// ── Helpers ─────────────────────────────────────────────────────────────────
function getStraight(race: Race): number {
  return STRAIGHT_MAP[`${race.venue}${race.surface_type}`] || 300;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

function fmtVideoTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function parseTimeInput(s: string): number | null {
  const m1 = s.match(/^(\d+):(\d{2})\.(\d+)$/);
  if (m1) return parseInt(m1[1]) * 60 + parseInt(m1[2]) + parseFloat(`0.${m1[3]}`);
  const m2 = s.match(/^(\d+):(\d{2})$/);
  if (m2) return parseInt(m2[1]) * 60 + parseInt(m2[2]);
  const m3 = s.match(/^(\d+\.?\d*)$/);
  if (m3) return parseFloat(m3[1]);
  return null;
}

function computeCheckpoints(distance: number, straight: number) {
  const straightStart = distance - straight;
  const pts200: { label: string; key: string; meter: number }[] = [
    { label: "5m地点\n(スタート)", key: "5m", meter: 5 },
  ];
  for (let m = 200; m < straightStart; m += 200) {
    pts200.push({ label: `${m}m`, key: `${m}m`, meter: m });
  }
  const firstStraight = Math.ceil(straightStart / 50) * 50;
  const ptsStr: { label: string; key: string; meter: number }[] = [];
  for (let m = firstStraight; m < distance; m += 50) {
    ptsStr.push({ label: `${m}m`, key: `${m}m`, meter: m });
  }
  ptsStr.push({ label: "ゴール", key: "ゴール", meter: distance });
  return { pts200, ptsStr };
}

function cpVideoTime(meter: number, distance: number, baseSec: number, videoOffset: number = VIDEO_OFFSET): number {
  if (meter <= 5) return videoOffset;
  if (meter >= distance) return videoOffset + baseSec;
  return videoOffset + baseSec * (meter / distance);
}

function interpolateBboxes(keyframes: Record<number, BBox[]>, frame: number): BBox[] {
  const frameNums = Object.keys(keyframes).map(Number).sort((a, b) => a - b);
  if (frameNums.length === 0) return [];
  const prev = [...frameNums].reverse().find((f) => f <= frame);
  const next = frameNums.find((f) => f > frame);
  if (prev === undefined) return keyframes[frameNums[0]];
  if (next === undefined) return keyframes[prev];
  if (prev === frame) return keyframes[prev];
  const t = (frame - prev) / (next - prev);
  const prevBboxes = keyframes[prev];
  const nextBboxes = keyframes[next];
  return prevBboxes.map((pb) => {
    const nb = nextBboxes.find((b) => b.id === pb.id);
    if (!nb) return pb;
    return {
      ...pb,
      x: pb.x + (nb.x - pb.x) * t,
      y: pb.y + (nb.y - pb.y) * t,
      w: pb.w + (nb.w - pb.w) * t,
      h: pb.h + (nb.h - pb.h) * t,
    };
  });
}

function generateSampleBboxes(entries: any[], cpType: string): BBox[] {
  const n = entries.length;
  const boxW = 0.055;
  const boxH = 0.16;
  return entries.map((entry, i) => {
    let x: number, y: number;
    if (cpType === "start") {
      x = 0.04 + (i / Math.max(n - 1, 1)) * 0.88;
      y = 0.52;
    } else if (cpType === "straight") {
      x = 0.25 + (i / Math.max(n - 1, 1)) * 0.45;
      y = 0.28 + (i % 3) * 0.08;
    } else {
      x = 0.08 + (i / Math.max(n - 1, 1)) * 0.75;
      y = 0.40 + Math.sin(i * 0.8) * 0.07;
    }
    return {
      id: `init-${entry.horse_number}`,
      horseNumber: entry.horse_number as number,
      gateNumber: entry.gate_number as number ?? null,
      x: Math.max(0, Math.min(1 - boxW, x)),
      y: Math.max(0, Math.min(1 - boxH, y)),
      w: boxW,
      h: boxH,
    };
  });
}

function AccBadge({ v }: { v?: number | null }) {
  if (v == null) return <span className="text-zinc-600">-</span>;
  const color = v >= 90 ? "text-green-400" : v >= 75 ? "text-yellow-400" : "text-red-400";
  return <span className={`font-mono text-xs ${color}`}>{v}%</span>;
}

function CapCircle({ gate }: { gate?: number | null }) {
  const c = gate != null ? CAP_COLORS[gate] : null;
  if (!c) return <span className="text-zinc-500 text-xs">-</span>;
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold border border-white/20"
      style={{ backgroundColor: c.bg, color: c.text }}
      title={c.label}
    >
      {c.label[0]}
    </span>
  );
}

// ── BBOX Canvas ───────────────────────────────────────────────────────────────
const HANDLE_R = 5;

function BboxCanvas({
  bboxes,
  addPreview,
  selectedId,
  addMode,
  isEditing,
  onSelect,
  onAdd,
  onUpdate,
  onDelete,
}: {
  bboxes: BBox[];
  addPreview: { x: number; y: number; w: number; h: number } | null;
  selectedId: string | null;
  addMode: boolean;
  isEditing: boolean;
  onSelect: (id: string | null) => void;
  onAdd: (b: Omit<BBox, "id">) => void;
  onUpdate: (id: string, updates: Partial<Pick<BBox, "x" | "y" | "w" | "h">>) => void;
  onDelete: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const dragRef = useRef<{
    type: "move" | "resize" | "add";
    id?: string;
    handle?: DragHandle;
    startX: number;
    startY: number;
    origBox?: Pick<BBox, "x" | "y" | "w" | "h">;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = size;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    const drawBox = (
      b: Pick<BBox, "x" | "y" | "w" | "h"> & { id?: string; horseNumber?: number | null; gateNumber?: number | null },
      isSelected: boolean,
      isPreview: boolean,
    ) => {
      const px = b.x * w, py = b.y * h, pw = b.w * w, ph = b.h * h;
      const cap = b.gateNumber != null ? CAP_COLORS[b.gateNumber] : null;
      const stroke = isPreview ? "#f97316" : isSelected ? "#f97316" : cap?.bg ?? "#ea580c";

      ctx.setLineDash(isPreview ? [6, 3] : []);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = isSelected || isPreview ? 2.5 : 1.5;
      ctx.strokeRect(px, py, pw, ph);
      ctx.setLineDash([]);

      ctx.fillStyle = isSelected ? "rgba(249,115,22,0.12)" : "rgba(255,255,255,0.05)";
      ctx.fillRect(px, py, pw, ph);

      if (!isPreview) {
        const label = b.horseNumber != null ? String(b.horseNumber) : "?";
        const lw = 18, lh = 14;
        ctx.fillStyle = cap?.bg ?? "#ea580c";
        ctx.fillRect(px, py - lh, lw, lh);
        ctx.fillStyle = cap?.text ?? "#fff";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, px + lw / 2, py - lh / 2);
      }

      if (isSelected && isEditing && !isPreview) {
        const corners: [number, number][] = [
          [px, py], [px + pw, py], [px, py + ph], [px + pw, py + ph],
        ];
        for (const [cx, cy] of corners) {
          ctx.fillStyle = "#f97316";
          ctx.beginPath();
          ctx.arc(cx, cy, HANDLE_R, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    };

    for (const bbox of bboxes) {
      drawBox(bbox, bbox.id === selectedId, false);
    }
    if (addPreview && addPreview.w > 0 && addPreview.h > 0) {
      drawBox(addPreview, false, true);
    }
  }, [bboxes, addPreview, selectedId, size, isEditing]);

  const toRel = (px: number, py: number) => ({ rx: px / size.w, ry: py / size.h });
  const getPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  };

  const hitTest = (px: number, py: number): { id: string; handle: DragHandle } | null => {
    const { w, h } = size;
    if (selectedId) {
      const sel = bboxes.find((b) => b.id === selectedId);
      if (sel) {
        const bx = sel.x * w, by = sel.y * h, bw = sel.w * w, bh = sel.h * h;
        const corners: [number, number, DragHandle][] = [
          [bx, by, "tl"], [bx + bw, by, "tr"], [bx, by + bh, "bl"], [bx + bw, by + bh, "br"],
        ];
        for (const [cx, cy, handle] of corners) {
          if (Math.hypot(px - cx, py - cy) <= HANDLE_R + 4) return { id: sel.id, handle };
        }
      }
    }
    for (const bbox of [...bboxes].reverse()) {
      const bx = bbox.x * w, by = bbox.y * h, bw = bbox.w * w, bh = bbox.h * h;
      if (px >= bx && px <= bx + bw && py >= by && py <= by + bh) {
        return { id: bbox.id, handle: "body" };
      }
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const { px, py } = getPos(e);
    if (addMode) {
      const { rx, ry } = toRel(px, py);
      dragRef.current = { type: "add", startX: px, startY: py, origBox: { x: rx, y: ry, w: 0, h: 0 } };
      return;
    }
    const hit = hitTest(px, py);
    if (!hit) { onSelect(null); return; }
    onSelect(hit.id);
    if (!isEditing) return;
    const bbox = bboxes.find((b) => b.id === hit.id)!;
    if (hit.handle === "body") {
      dragRef.current = { type: "move", id: hit.id, startX: px, startY: py, origBox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h } };
    } else {
      dragRef.current = { type: "resize", id: hit.id, handle: hit.handle, startX: px, startY: py, origBox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h } };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { px, py } = getPos(e);
    const dx = (px - d.startX) / size.w;
    const dy = (py - d.startY) / size.h;

    if (d.type === "add") {
      const sx = d.startX / size.w, sy = d.startY / size.h;
      const ex = px / size.w, ey = py / size.h;
      const newPreview = {
        x: Math.max(0, Math.min(sx, ex)),
        y: Math.max(0, Math.min(sy, ey)),
        w: Math.abs(ex - sx),
        h: Math.abs(ey - sy),
      };
      d.origBox = newPreview;
      (window as any).__bboxAddPreviewSetter?.(newPreview);
      return;
    }

    if (d.type === "move" && d.id && d.origBox) {
      const o = d.origBox;
      onUpdate(d.id, {
        x: Math.max(0, Math.min(1 - o.w, o.x + dx)),
        y: Math.max(0, Math.min(1 - o.h, o.y + dy)),
      });
    }

    if (d.type === "resize" && d.id && d.origBox) {
      const o = d.origBox;
      let { x, y, w, h } = o;
      if (d.handle === "tl" || d.handle === "bl") { x = o.x + dx; w = o.w - dx; }
      if (d.handle === "tr" || d.handle === "br") { w = o.w + dx; }
      if (d.handle === "tl" || d.handle === "tr") { y = o.y + dy; h = o.h - dy; }
      if (d.handle === "bl" || d.handle === "br") { h = o.h + dy; }
      if (w > 0.02 && h > 0.02) onUpdate(d.id, { x, y, w, h });
    }
  };

  const handleMouseUp = () => {
    const d = dragRef.current;
    if (d?.type === "add" && d.origBox && d.origBox.w > 0.015 && d.origBox.h > 0.015) {
      onAdd({ horseNumber: null, gateNumber: null, ...d.origBox });
    }
    (window as any).__bboxAddPreviewSetter?.(null);
    dragRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      e.preventDefault();
      onDelete(selectedId);
    }
  };

  const cursor = addMode ? "crosshair" : isEditing ? "default" : "default";

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      />
    </div>
  );
}

// ── History Modal ─────────────────────────────────────────────────────────────
interface HistoryEntry {
  id: string; user_name: string; action_type: string;
  description?: string; created_at: string;
}

function HistoryModal({
  raceId, onClose, correctionRequestComment, isEditingMode, onRestore,
}: {
  raceId: string; onClose: () => void; correctionRequestComment?: string | null;
  isEditingMode: boolean; onRestore?: (entryId: string) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"history" | "comment">("history");
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/races/${raceId}/history`)
      .then((r) => r.json())
      .then((d) => { setEntries(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [raceId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[600px] max-w-[95vw] flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">修正履歴 / コメント</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-zinc-800 rounded overflow-hidden border border-zinc-700">
              <button
                onClick={() => setTab("history")}
                className={`px-3 py-1 text-[10px] cursor-pointer transition-colors ${tab === "history" ? "bg-primary text-white" : "text-zinc-400 hover:text-white"}`}
              >修正履歴</button>
              {correctionRequestComment && (
                <button
                  onClick={() => setTab("comment")}
                  className={`px-3 py-1 text-[10px] cursor-pointer transition-colors ${tab === "comment" ? "bg-orange-600 text-white" : "text-zinc-400 hover:text-white"}`}
                >修正要請コメント</button>
              )}
            </div>
            <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer text-lg leading-none">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {tab === "comment" && correctionRequestComment ? (
            <div className="p-5">
              <div className="bg-orange-950/30 border border-orange-800/50 rounded-lg p-4">
                <div className="text-xs font-semibold text-orange-400 mb-2">修正要請コメント</div>
                <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{correctionRequestComment}</p>
              </div>
            </div>
          ) : loading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">履歴がありません</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-zinc-800 sticky top-0">
                <tr>
                  <th className="p-2 text-left text-muted-foreground font-medium w-36">日時</th>
                  <th className="p-2 text-left text-muted-foreground font-medium w-20">担当者</th>
                  <th className="p-2 text-left text-muted-foreground font-medium w-20">種別</th>
                  <th className="p-2 text-left text-muted-foreground font-medium">内容</th>
                  {isEditingMode && <th className="p-2 text-center text-muted-foreground font-medium w-16">復元</th>}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-zinc-800 hover:bg-zinc-800/40">
                    <td className="p-2 text-muted-foreground font-mono whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="p-2">{e.user_name}</td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        e.action_type === "補正完了" || e.action_type === "データ確定" ? "bg-green-900/50 text-green-400"
                          : e.action_type === "補正開始" || e.action_type === "補正再開" ? "bg-blue-900/50 text-blue-400"
                          : e.action_type === "修正要請" ? "bg-orange-900/50 text-orange-400"
                          : "bg-zinc-700 text-zinc-300"
                      }`}>{e.action_type}</span>
                    </td>
                    <td className="p-2 text-muted-foreground">{e.description || "-"}</td>
                    {isEditingMode && (
                      <td className="p-2 text-center">
                        <button
                          onClick={() => setRestoreTarget(e.id)}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 cursor-pointer underline"
                        >復元</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {restoreTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[400px] p-6">
            <h2 className="text-sm font-semibold mb-2">データ復元の確認</h2>
            <p className="text-sm text-muted-foreground mb-5">この時点の状態に復元しますか？現在の編集内容は失われます。</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setRestoreTarget(null)} className="h-8 text-xs cursor-pointer">キャンセル</Button>
              <Button size="sm" onClick={() => { onRestore?.(restoreTarget); setRestoreTarget(null); onClose(); }} className="h-8 text-xs cursor-pointer bg-cyan-700 hover:bg-cyan-600">復元する</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Confirm Dialog ─────────────────────────────────────────────────────────────
function ConfirmDialog({
  title, message, confirmLabel, onConfirm, onCancel, loading, confirmColor,
}: {
  title: string; message: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void; loading?: boolean; confirmColor?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[400px] max-w-[95vw] p-6">
        <h2 className="text-sm font-semibold mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground mb-5">{message}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading} className="h-8 text-xs cursor-pointer">キャンセル</Button>
          <Button size="sm" onClick={onConfirm} disabled={loading} className={`h-8 text-xs cursor-pointer ${confirmColor || "bg-primary hover:bg-primary/90"}`}>
            {loading ? "処理中..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Temp Save Dialog (3 options) ──────────────────────────────────────────────
function TempSaveDialog({
  onCancel, onSaveAndExit, onSaveAndContinue, loading,
}: {
  onCancel: () => void; onSaveAndExit: () => void; onSaveAndContinue: () => void; loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[440px] max-w-[95vw] p-6">
        <h2 className="text-sm font-semibold mb-2">一時保存の確認</h2>
        <p className="text-sm text-muted-foreground mb-5">現在の入力情報を一時保存しますか？</p>
        <div className="flex flex-col gap-2">
          <Button size="sm" onClick={onSaveAndContinue} disabled={loading} className="h-8 text-xs cursor-pointer bg-primary hover:bg-primary/90 w-full">
            {loading ? "保存中..." : "一時保存して編集続行"}
          </Button>
          <Button size="sm" onClick={onSaveAndExit} disabled={loading} className="h-8 text-xs cursor-pointer bg-blue-700 hover:bg-blue-600 w-full">
            一時保存して編集モードを終了
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading} className="h-8 text-xs cursor-pointer w-full">
            キャンセル
          </Button>
        </div>
      </div>
    </div>
  );
}


// ── Correction Request Dialog (修正要請) ──────────────────────────────────────
function CorrectionRequestDialog({
  raceName, onCancel, onSubmit, loading,
}: {
  raceName: string; onCancel: () => void; onSubmit: (comment: string) => void; loading?: boolean;
}) {
  const [comment, setComment] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[480px] max-w-[95vw] p-6">
        <h2 className="text-sm font-semibold mb-3">修正要請</h2>
        <div className="text-xs text-muted-foreground mb-1">対象レース</div>
        <div className="text-sm font-medium mb-4">{raceName}</div>
        <div className="mb-5">
          <div className="text-xs font-medium text-muted-foreground mb-1">差し戻し理由 <span className="text-red-400">（必須）</span></div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded text-sm p-2 text-foreground resize-none h-24"
            placeholder="差し戻しの理由を入力してください"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading} className="h-8 text-xs cursor-pointer">キャンセル</Button>
          <Button size="sm" onClick={() => onSubmit(comment)} disabled={loading || !comment.trim()} className="h-8 text-xs cursor-pointer bg-yellow-700 hover:bg-yellow-600">
            {loading ? "送信中..." : "修正要請を送信"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Analysis Option Dialog (解析オプション) ───────────────────────────────────
interface VenueWeatherPreset {
  id: string; name: string; venue_code: string; weather_preset_code: string; surface_type: string;
}

const REANALYSIS_REASONS_DIALOG = ["逆光", "曇り", "雨天", "その他"];

function AnalysisOptionDialog({
  raceId, raceName, onCancel, onSaved, isAdmin, onReanalyze, onReanalysisRequest, loading: parentLoading,
}: {
  raceId: string; raceName: string; onCancel: () => void;
  onSaved: () => void; isAdmin: boolean;
  onReanalyze: () => void; onReanalysisRequest: (reason: string, comment: string) => void;
  loading?: boolean;
}) {
  const [goalTime, setGoalTime] = useState("");
  const [presetId, setPresetId] = useState<string>("");
  const [comment, setComment] = useState("");
  const [presets, setPresets] = useState<VenueWeatherPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [showReanalysisForm, setShowReanalysisForm] = useState(false);
  const [reanalysisReason, setReanalysisReason] = useState("逆光");

  useEffect(() => {
    Promise.all([
      fetch(`${API}/races/${raceId}/analysis-option`).then((r) => r.json()),
      fetch(`${API}/venue-weather-presets`).then((r) => r.json()),
    ]).then(([existing, presetList]) => {
      setPresets(presetList || []);
      if (existing) {
        if (existing.video_goal_time != null) setGoalTime(String(existing.video_goal_time));
        if (existing.venue_weather_preset_id) setPresetId(existing.venue_weather_preset_id);
        if (existing.comment) setComment(existing.comment);
      }
      setFetching(false);
    }).catch(() => setFetching(false));
  }, [raceId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (goalTime.trim()) body.video_goal_time = parseFloat(goalTime);
      if (presetId) body.venue_weather_preset_id = presetId;
      if (comment.trim()) body.comment = comment;
      const res = await fetch(`${API}/races/${raceId}/analysis-option`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
      onSaved();
    } catch {
      setSaving(false);
    }
  };

  const handleReanalyze = () => {
    onReanalyze();
  };

  const handleReanalysisRequest = () => {
    const isOther = reanalysisReason === "その他";
    if (isOther && !comment.trim()) return;
    onReanalysisRequest(reanalysisReason, comment);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[480px] max-w-[95vw] p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">解析オプション</h2>
          <button onClick={onCancel} className="text-zinc-400 hover:text-white cursor-pointer text-lg leading-none">✕</button>
        </div>
        {fetching ? (
          <div className="text-xs text-muted-foreground py-4 text-center">読み込み中...</div>
        ) : (
          <>
            <div className="mb-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">ゴールタイム（1/100秒まで）</div>
              <input
                type="text"
                value={goalTime}
                onChange={(e) => setGoalTime(e.target.value)}
                placeholder="例: 120.50"
                className="w-full bg-zinc-800 border border-zinc-700 rounded text-sm p-2 text-foreground"
              />
            </div>
            <div className="mb-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">解析プリセット</div>
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded text-sm p-2 text-foreground cursor-pointer"
              >
                <option value="">選択してください</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <div className="text-xs font-medium text-muted-foreground mb-1">コメント{showReanalysisForm && reanalysisReason === "その他" ? <span className="text-red-400 ml-1">（必須）</span> : "（任意）"}</div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded text-sm p-2 text-foreground resize-none h-20"
                placeholder="メモを入力してください"
              />
            </div>

            {showReanalysisForm && (
              <div className="mb-4 border border-zinc-700 rounded p-3 bg-zinc-800/50">
                <div className="text-xs font-medium text-muted-foreground mb-2">再解析理由</div>
                <div className="grid grid-cols-2 gap-2">
                  {REANALYSIS_REASONS_DIALOG.map((r) => (
                    <button
                      key={r}
                      onClick={() => setReanalysisReason(r)}
                      className={`py-1.5 px-2 rounded text-xs font-medium border transition-colors cursor-pointer ${
                        reanalysisReason === r
                          ? "bg-red-500/20 border-red-500 text-red-400"
                          : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500"
                      }`}
                    >{r}</button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        <div className="flex gap-2 justify-between">
          <div className="flex gap-2">
            {isAdmin && (
              <Button size="sm" onClick={handleReanalyze} disabled={saving || fetching} className="h-8 text-xs cursor-pointer bg-zinc-700 hover:bg-zinc-600 text-white border-0">
                再解析
              </Button>
            )}
            {showReanalysisForm ? (
              <Button
                size="sm"
                onClick={handleReanalysisRequest}
                disabled={saving || fetching || (reanalysisReason === "その他" && !comment.trim())}
                className="h-8 text-xs cursor-pointer bg-red-700 hover:bg-red-600 text-white border-0"
              >
                再解析要請を送信
              </Button>
            ) : (
              <Button size="sm" onClick={() => setShowReanalysisForm(true)} disabled={saving || fetching} className="h-8 text-xs cursor-pointer bg-zinc-700 hover:bg-zinc-600 text-white border-0">
                再解析要請
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {showReanalysisForm ? (
              <Button variant="outline" size="sm" onClick={() => setShowReanalysisForm(false)} className="h-8 text-xs cursor-pointer">戻る</Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={onCancel} disabled={saving} className="h-8 text-xs cursor-pointer">キャンセル</Button>
                <Button size="sm" onClick={handleSave} disabled={saving || fetching} className="h-8 text-xs cursor-pointer bg-primary hover:bg-primary/90">
                  {saving ? "保存中..." : "保存"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bind Analysis Dialog (解析データ再紐付け) ─────────────────────────────────
interface AnalysisDataItem {
  id: string; label: string; date: string; venue: string; race_number: number;
  race_name: string; distance: number; surface_type: string;
  same_venue: boolean; mismatch: boolean;
}

function BindAnalysisDialog({
  raceId, raceName, onCancel, onBind, loading,
}: {
  raceId: string; raceName: string; onCancel: () => void;
  onBind: (analysisDataId: string) => void; loading?: boolean;
}) {
  const [items, setItems] = useState<AnalysisDataItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mismatchAlert, setMismatchAlert] = useState(false);

  useEffect(() => {
    fetch(`${API}/races/${raceId}/available-analysis`)
      .then((r) => r.json())
      .then((d) => { setItems(d); setFetching(false); })
      .catch(() => setFetching(false));
  }, [raceId]);

  // Group items by venue: same_venue first, then others
  const sameVenueItems = items.filter((i) => i.same_venue);
  const otherVenueItems = items.filter((i) => !i.same_venue);

  const handleSelect = (item: AnalysisDataItem) => {
    if (item.mismatch) {
      setMismatchAlert(true);
      return;
    }
    setMismatchAlert(false);
    setSelectedId(item.id);
  };

  const renderItem = (item: AnalysisDataItem) => (
    <button
      key={item.id}
      onClick={() => handleSelect(item)}
      className={`w-full text-left px-3 py-2.5 rounded border transition-colors ${
        item.mismatch
          ? "bg-zinc-900/60 border-amber-800/60 text-zinc-500 cursor-not-allowed"
          : selectedId === item.id
            ? "bg-indigo-900/30 border-indigo-500 text-indigo-300 cursor-pointer"
            : "bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:border-zinc-500 cursor-pointer"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {item.mismatch && (
            <span className="text-[9px] bg-amber-800/50 text-amber-400 border border-amber-700/50 rounded px-1 py-0.5">レース名不一致</span>
          )}
          <span className="text-xs font-semibold">{item.venue} {item.race_number}R</span>
          <span className="text-[10px] text-zinc-400">{item.surface_type} {item.distance}m</span>
        </div>
        <span className="text-[10px] text-zinc-500">{item.date}</span>
      </div>
      <div className="text-[10px] text-zinc-400 mt-0.5">{item.race_name}</div>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[560px] max-w-[95vw] flex flex-col max-h-[70vh]">
        <div className="p-4 border-b border-zinc-700">
          <h2 className="text-sm font-semibold mb-1">解析データ再紐付け</h2>
          <p className="text-xs text-muted-foreground">対象: {raceName}</p>
          <p className="text-xs text-zinc-500 mt-1">同日の解析済みデータから正しい解析データを選択してください</p>
        </div>
        {mismatchAlert && (
          <div className="flex items-start gap-2 mx-4 mt-3 bg-amber-950/40 border border-amber-800/50 rounded-md p-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-300 leading-relaxed">
              選択した解析データはレース名が異なるため紐付けできません。競馬場・日付・レース名が一致するデータのみ選択できます。
            </p>
            <button onClick={() => setMismatchAlert(false)} className="ml-auto text-zinc-500 hover:text-zinc-300 cursor-pointer">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-auto p-2 space-y-3">
          {fetching ? (
            <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">利用可能な解析データがありません</div>
          ) : (
            <>
              {sameVenueItems.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground px-1 pb-1.5">同一競馬場</div>
                  <div className="space-y-1.5">{sameVenueItems.map(renderItem)}</div>
                </div>
              )}
              {otherVenueItems.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground px-1 pb-1.5">他競馬場（同日）</div>
                  <div className="space-y-1.5">{otherVenueItems.map(renderItem)}</div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2 justify-end p-4 border-t border-zinc-700">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading} className="h-8 text-xs cursor-pointer">キャンセル</Button>
          <Button size="sm" onClick={() => selectedId && onBind(selectedId)} disabled={loading || !selectedId} className="h-8 text-xs cursor-pointer bg-indigo-700 hover:bg-indigo-600">
            {loading ? "紐付け中..." : "この解析データに紐付ける"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Status Detail Popup ───────────────────────────────────────────────────────
function StatusDetailPopup({
  race, onClose,
}: {
  race: any; onClose: () => void;
}) {
  const status = race?.display_status ?? race?.status;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[440px] max-w-[95vw] p-6">
        {status === "再解析要請" && (
          <>
            <h2 className="text-sm font-semibold mb-3 text-rose-400">再解析要請の詳細</h2>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">理由: <span className="text-foreground font-medium">{race.reanalysis_reason || "-"}</span></div>
              {race.reanalysis_comment && (
                <div className="bg-zinc-800 rounded p-3 text-sm text-zinc-200">{race.reanalysis_comment}</div>
              )}
            </div>
          </>
        )}
        {status === "修正要請" && (
          <>
            <h2 className="text-sm font-semibold mb-3 text-orange-400">修正要請の詳細</h2>
            {race.correction_request_comment && (
              <div className="bg-zinc-800 rounded p-3 text-sm text-zinc-200">{race.correction_request_comment}</div>
            )}
          </>
        )}
        <div className="flex justify-end mt-4">
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs cursor-pointer">閉じる</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DataCorrection() {
  const params = useParams();
  const raceId = params.raceId as string;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useUserRole();

  // UI state
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<
    "save" | "complete" | "cancel" | "forceUnlock" | "confirm" | "matchingFailure" | "correctionRequest" | "statusDetail" | "bindAnalysis" | "analysisOption" | null
  >(null);
  const [leftView, setLeftView] = useState<"furlong" | "entries" | "both">("both");
  const [selectedCp, setSelectedCp] = useState<string | null>(null);

  // Edit mode: purely local; resets when leaving the page
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [savingTemp, setSavingTemp] = useState(false);
  const [cpErrors, setCpErrors] = useState<Record<string, { missing: number; anomalies: number }>>({});
  const [entrySortBy, setEntrySortBy] = useState<"horse_number" | "finish_position">("horse_number");
  const [analysisPreset, setAnalysisPreset] = useState<string>("標準");
  const [analysisParamsData, setAnalysisParamsData] = useState<Record<string, any> | null>(null);

  // Editable start/goal times (video offset + race duration in seconds)
  const [customVideoOffset, setCustomVideoOffset] = useState<number | null>(null);
  const [customRaceDuration, setCustomRaceDuration] = useState<number | null>(null);
  const [startTimeInput, setStartTimeInput] = useState<string>("");
  const [goalTimeInput, setGoalTimeInput] = useState<string>("");

  // Video state
  const [videoTime, setVideoTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1.0);
  const [rulerEnabled, setRulerEnabled] = useState(false);
  const [rulerY, setRulerY] = useState(50);
  const [rulerAngle, setRulerAngle] = useState(0);
  const [vrulerEnabled, setVrulerEnabled] = useState(false);
  const [vrulerX, setVrulerX] = useState(50);
  const [vrulerAngle, setVrulerAngle] = useState(0);

  // BBOX state
  const [keyframes, setKeyframes] = useState<Keyframes>({});
  const [selectedBboxId, setSelectedBboxId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [addPreview, setAddPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Expose setter to canvas via window (avoids prop drilling for mouse-move preview)
  useEffect(() => {
    (window as any).__bboxAddPreviewSetter = setAddPreview;
    return () => { delete (window as any).__bboxAddPreviewSetter; };
  }, []);

  // Local edits for right-panel fields
  const [localEdits, setLocalEdits] = useState<Record<string, Record<string, unknown>>>({});

  // Video timer
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks which race IDs have already triggered auto-edit-mode (prevents re-trigger after cancel)
  const autoEditRef = useRef<Set<string>>(new Set());

  // API hooks
  const { data: race, isLoading: isRaceLoading } = useGetRace(raceId, {
    query: { enabled: !!raceId, queryKey: getGetRaceQueryKey(raceId) },
  });
  const { data: entries } = useGetRaceEntries(raceId, {
    query: { enabled: !!raceId, queryKey: getGetRaceEntriesQueryKey(raceId) },
  });
  const { data: passingOrders, isLoading: isOrdersLoading } = useGetPassingOrders(
    raceId,
    { checkpoint: selectedCp ?? undefined },
    { query: { enabled: !!raceId && !!selectedCp, queryKey: getGetPassingOrdersQueryKey(raceId, { checkpoint: selectedCp ?? undefined }) } },
  );

  const startCorrectionMut = useStartCorrection();
  const completeCorrectionMut = useCompleteCorrection();

  // Race metadata
  const straight = race ? getStraight(race) : 300;
  const { pts200, ptsStr } = useMemo(
    () => computeCheckpoints(race?.distance ?? 2000, straight),
    [race?.distance, straight],
  );
  const baseSec = race ? (race.distance / 1000) * 60 + 27 : 90;
  const effectiveVideoOffset = customVideoOffset ?? VIDEO_OFFSET;
  const effectiveBaseSec = customRaceDuration ?? baseSec;
  const totalVideoSec = effectiveVideoOffset + effectiveBaseSec;

  // Initialize start/goal inputs when race loads (only if not yet set)
  useEffect(() => {
    if (!race) return;
    const computed = (race.distance / 1000) * 60 + 27;
    setStartTimeInput(fmtTime(VIDEO_OFFSET));
    setGoalTimeInput(fmtTime(computed));
    setCustomVideoOffset(null);
    setCustomRaceDuration(null);
  }, [race?.id]);
  const currentFrame = Math.floor(videoTime * FPS);

  useEffect(() => {
    if (!raceId) return;
    fetch(`${API}/races/${raceId}/checkpoint-errors`)
      .then((r) => r.json())
      .then((data) => setCpErrors(data))
      .catch(() => {});
  }, [raceId]);

  useEffect(() => {
    if (!race?.venue) return;
    const venueId = VENUE_ID_MAP[race.venue];
    if (!venueId) return;
    fetch(`${API}/analysis-params/${venueId}`)
      .then((r) => r.json())
      .then((d) => setAnalysisParamsData(d.params ?? {}))
      .catch(() => {});
  }, [race?.venue]);

  // Video timer effect
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setVideoTime((t) => {
          const next = t + 0.1 * playSpeed;
          if (next >= totalVideoSec) { setIsPlaying(false); return totalVideoSec; }
          return next;
        });
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPlaying, playSpeed, totalVideoSec]);

  // Current bboxes (interpolated)
  const currentBboxes = useMemo(() => {
    if (!selectedCp) return [];
    const cpKf = keyframes[selectedCp] ?? {};
    return interpolateBboxes(cpKf, currentFrame);
  }, [keyframes, selectedCp, currentFrame]);

  // Initialize sample bboxes when checkpoint selected and in editing mode
  useEffect(() => {
    if (!selectedCp || !entries || entries.length === 0 || !isEditingMode) return;
    setKeyframes((prev) => {
      if (Object.keys(prev[selectedCp] ?? {}).length > 0) return prev;
      const cpType = ptsStr.some((p) => p.key === selectedCp) ? "straight"
        : selectedCp === "5m" ? "start" : "200m";
      const sample = generateSampleBboxes(entries, cpType);
      return { ...prev, [selectedCp]: { 0: sample } };
    });
  }, [selectedCp, entries?.length, isEditingMode]);

  // cpType
  const cpType = useMemo(() => {
    if (!selectedCp) return null;
    if (selectedCp === "5m") return "start";
    if (ptsStr.some((p) => p.key === selectedCp)) return "straight";
    return "200m";
  }, [selectedCp, ptsStr]);

  const numHorses = entries?.length ?? 14;
  const furlongSplits = (entries?.[0] as any)?.furlong_splits ?? [];

  // Display orders with local edits applied
  const displayOrders = useMemo(() => {
    if (!passingOrders) return [];
    return passingOrders.map((o) => ({ ...o, ...(localEdits[o.id] ?? {}) }));
  }, [passingOrders, localEdits]);

  const setEdit = (id: string, field: string, value: unknown) => {
    setLocalEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }));
  };

  // Save all edits — uses the full analysis-result endpoint that accepts all fields
  const saveAllEdits = useCallback(async () => {
    for (const [id, changes] of Object.entries(localEdits)) {
      if (!Object.keys(changes).length) continue;
      await fetch(`${API}/races/${raceId}/analysis-result/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
    }
    setLocalEdits({});
  }, [localEdits, raceId]);

  const currentUserName = isAdmin ? "管理者" : "ユーザー";
  const raceLockedBy = race?.locked_by;
  const isLockedByMe = raceLockedBy === currentUserName || !raceLockedBy;
  const isLockedByOther = !!raceLockedBy && raceLockedBy !== currentUserName;
  const raceStatus = race?.display_status ?? race?.status ?? "";

  useEffect(() => {
    if (!race?.id) return;
    if (autoEditRef.current.has(race.id)) return;
    if (
      raceStatus === "補正中" &&
      raceLockedBy === currentUserName
    ) {
      autoEditRef.current.add(race.id);
      setIsEditingMode(true);
    }
  }, [race?.id, raceStatus, raceLockedBy, currentUserName]);

  // 補正開始 / 補正再開
  const handleStart = () => {
    if (raceStatus === "補正中" && isLockedByMe) {
      setIsEditingMode(true);
      return;
    }
    fetch(`${API}/races/${raceId}/corrections/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_name: currentUserName }),
    })
      .then((r) => { if (!r.ok) throw new Error("Lock failed"); return r.json(); })
      .then((updated) => {
        queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
        const actionType = raceStatus === "修正要請" || raceStatus === "補正中" ? "補正再開" : "補正開始";
        fetch(`${API}/races/${raceId}/history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_name: currentUserName, action_type: actionType, description: `${actionType}しました` }),
        });
        setIsEditingMode(true);
        toast({ title: `${actionType}しました` });
      })
      .catch(() => toast({ title: "ロック取得に失敗しました。他のユーザーが編集中です。", variant: "destructive" }));
  };

  // 一時保存 + 編集続行
  const handleTempSaveContinue = async () => {
    setSavingTemp(true);
    await saveAllEdits();
    fetch(`${API}/races/${raceId}/corrections/temp-save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_name: currentUserName, exit_editing: false }),
    });
    fetch(`${API}/races/${raceId}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_name: currentUserName, action_type: "一時保存", description: "入力データを一時保存しました" }),
    });
    toast({ title: "一時保存しました" });
    setSavingTemp(false);
    setConfirmDialog(null);
  };

  // 一時保存 + 編集終了
  const handleTempSaveExit = async () => {
    setSavingTemp(true);
    await saveAllEdits();
    const res = await fetch(`${API}/races/${raceId}/corrections/temp-save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_name: currentUserName, exit_editing: true }),
    });
    const updated = await res.json();
    queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
    fetch(`${API}/races/${raceId}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_name: currentUserName, action_type: "一時保存", description: "一時保存して編集を終了しました" }),
    });
    toast({ title: "一時保存して編集を終了しました" });
    setIsEditingMode(false);
    setLocalEdits({});
    setSavingTemp(false);
    setConfirmDialog(null);
  };

  // 補正完了
  const handleComplete = async () => {
    if (hasDuplicateHorseNumbers) {
      toast({ title: "同一地点に同じ馬番が複数あります", description: "馬番の重複を解消してください", variant: "destructive" });
      setConfirmDialog(null);
      return;
    }
    await saveAllEdits();
    completeCorrectionMut.mutate({ raceId }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
        fetch(`${API}/races/${raceId}/history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_name: currentUserName, action_type: "補正完了", description: "補正を完了しレビュー待ちに変更しました" }),
        });
        toast({ title: "補正完了。レビュー待ちに変更されました。" });
        setIsEditingMode(false);
        navigate("/");
      },
    });
    setConfirmDialog(null);
  };

  // キャンセル: check for unsaved changes
  const handleCancel = () => {
    if (Object.keys(localEdits).length > 0) {
      setConfirmDialog("cancel");
    } else {
      doCancel();
    }
  };

  const doCancel = async () => {
    await fetch(`${API}/races/${raceId}/corrections/cancel`, { method: "POST" });
    const res = await fetch(`${API}/races/${raceId}`);
    const updated = await res.json();
    queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
    setIsEditingMode(false);
    setLocalEdits({});
    setSelectedBboxId(null);
    setAddMode(false);
    setAddPreview(null);
    setConfirmDialog(null);
    toast({ title: "編集をキャンセルしました" });
  };

  // 突合申請
  const handleMatchingFailure = async () => {
    try {
      const res = await fetch(`${API}/races/${raceId}/matching-failure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: currentUserName }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
      await fetch(`${API}/races/${raceId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: currentUserName, action_type: "突合失敗", description: "突合失敗を申請しました" }),
      });
      toast({ title: "突合失敗を申請しました" });
      setIsEditingMode(false);
    } catch {
      toast({ title: "突合申請に失敗しました", variant: "destructive" });
    }
    setConfirmDialog(null);
  };

  // 再解析申請
  const handleReanalysisRequest = async (reason: string, comment: string) => {
    try {
      const res = await fetch(`${API}/races/${raceId}/reanalysis-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, comment: comment || null }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
      await fetch(`${API}/races/${raceId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: currentUserName, action_type: "再解析要請", description: `理由: ${reason}${comment ? ` / ${comment}` : ""}` }),
      });
      toast({ title: "再解析を要請しました" });
      setIsEditingMode(false);
    } catch {
      toast({ title: "再解析申請に失敗しました", variant: "destructive" });
    }
    setConfirmDialog(null);
  };

  // 修正要請 (admin)
  const handleCorrectionRequest = async (comment: string) => {
    try {
      const res = await fetch(`${API}/races/${raceId}/correction-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
      await fetch(`${API}/races/${raceId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: currentUserName, action_type: "修正要請", description: comment }),
      });
      toast({ title: "修正要請を送信しました" });
    } catch {
      toast({ title: "修正要請の送信に失敗しました", variant: "destructive" });
    }
    setConfirmDialog(null);
  };

  // データ確定 (admin)
  const handleConfirm = async () => {
    try {
      const res = await fetch(`${API}/races/${raceId}/confirm`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
      await fetch(`${API}/races/${raceId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: currentUserName, action_type: "データ確定", description: "データを確定しました" }),
      });
      toast({ title: "データを確定しました" });
    } catch {
      toast({ title: "データ確定に失敗しました", variant: "destructive" });
    }
    setConfirmDialog(null);
  };

  // 強制ロック解除 (admin)
  const handleForceUnlock = async () => {
    try {
      const res = await fetch(`${API}/races/${raceId}/force-unlock`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
      await fetch(`${API}/races/${raceId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: currentUserName, action_type: "強制ロック解除", description: `${raceLockedBy}のロックを強制解除しました` }),
      });
      toast({ title: "ロックを強制解除しました" });
    } catch {
      toast({ title: "ロック解除に失敗しました", variant: "destructive" });
    }
    setConfirmDialog(null);
  };

  // 解析データ再紐付け (admin)
  const handleBindAnalysis = async (analysisDataId: string) => {
    try {
      const res = await fetch(`${API}/races/${raceId}/bind-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis_data_id: analysisDataId }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
      await fetch(`${API}/races/${raceId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: currentUserName, action_type: "解析データ再紐付け", description: `解析データID: ${analysisDataId} に再紐付けしました` }),
      });
      toast({ title: "解析データを再紐付けしました" });
      queryClient.invalidateQueries({ queryKey: getGetPassingOrdersQueryKey(raceId, {}) });
    } catch {
      toast({ title: "再紐付けに失敗しました", variant: "destructive" });
    }
    setConfirmDialog(null);
  };

  // 履歴復元 (stub - requires backend restore endpoint)
  const handleRestore = (entryId: string) => {
    toast({ title: "復元機能は準備中です", description: `対象履歴: ${entryId}` });
  };

  // Checkpoint click
  const handleCpClick = (key: string, meter: number) => {
    setSelectedCp(key);
    setSelectedBboxId(null);
    const vt = cpVideoTime(meter, race?.distance ?? 2000, effectiveBaseSec, effectiveVideoOffset) - effectiveVideoOffset;
    setVideoTime(Math.max(0, vt));
  };

  // BBOX operations
  const handleAddBbox = useCallback((b: Omit<BBox, "id">) => {
    if (!selectedCp) return;
    if (currentBboxes.length >= numHorses) {
      toast({ title: `BBOX追加上限`, description: `最大${numHorses}個まで追加できます`, variant: "destructive" });
      return;
    }
    const id = `bbox-${Date.now()}`;
    const newBbox: BBox = { id, ...b };
    setKeyframes((prev) => {
      const cpKf = { ...(prev[selectedCp] ?? {}) };
      const existing = cpKf[currentFrame] ?? interpolateBboxes(cpKf, currentFrame);
      cpKf[currentFrame] = [...existing, newBbox];
      return { ...prev, [selectedCp]: cpKf };
    });
    setSelectedBboxId(id);
    setAddMode(false);
  }, [selectedCp, currentFrame]);

  const handleUpdateBbox = useCallback((id: string, updates: Partial<Pick<BBox, "x" | "y" | "w" | "h">>) => {
    if (!selectedCp) return;
    setKeyframes((prev) => {
      const cpKf = { ...(prev[selectedCp] ?? {}) };
      const existing = cpKf[currentFrame] ?? interpolateBboxes(cpKf, currentFrame);
      cpKf[currentFrame] = existing.map((b) => b.id === id ? { ...b, ...updates } : b);
      return { ...prev, [selectedCp]: cpKf };
    });
  }, [selectedCp, currentFrame]);

  const handleDeleteBbox = useCallback((id: string) => {
    if (!selectedCp) return;
    setKeyframes((prev) => {
      const cpKf = { ...(prev[selectedCp] ?? {}) };
      const existing = cpKf[currentFrame] ?? interpolateBboxes(cpKf, currentFrame);
      cpKf[currentFrame] = existing.filter((b) => b.id !== id);
      return { ...prev, [selectedCp]: cpKf };
    });
    setSelectedBboxId(null);
  }, [selectedCp, currentFrame]);

  const handleBboxHorseNumber = useCallback((id: string, num: number | null) => {
    if (!selectedCp) return;
    if (num != null && currentBboxes.some((b) => b.id !== id && b.horseNumber === num)) {
      toast({ title: `馬番${num}は既に割り当て済みです`, variant: "destructive" });
      return;
    }
    setKeyframes((prev) => {
      const cpKf = { ...(prev[selectedCp] ?? {}) };
      const existing = cpKf[currentFrame] ?? interpolateBboxes(cpKf, currentFrame);
      cpKf[currentFrame] = existing.map((b) => {
        if (b.id !== id) return b;
        const entry = entries?.find((e) => e.horse_number === num);
        return { ...b, horseNumber: num, gateNumber: entry?.gate_number ?? null };
      });
      return { ...prev, [selectedCp]: cpKf };
    });
  }, [selectedCp, currentFrame, currentBboxes, entries, toast]);

  const handleSaveKeyframe = useCallback(() => {
    if (!selectedCp) return;
    setKeyframes((prev) => {
      const cpKf = { ...(prev[selectedCp] ?? {}) };
      cpKf[currentFrame] = currentBboxes;
      return { ...prev, [selectedCp]: cpKf };
    });
    toast({ title: `フレーム ${currentFrame} をキーフレームとして保存しました` });
  }, [selectedCp, currentFrame, currentBboxes, toast]);

  // Recalculation — fills missing fields with random valid values
  const handleRecalculate = useCallback(async () => {
    if (!selectedCp || !passingOrders?.length) return;

    const is200m = cpType === "start" || cpType === "200m";
    const CAP_COLOR_MAP_FE: Record<number, string> = {
      1: "白", 2: "黒", 3: "赤", 4: "青", 5: "黄", 6: "緑", 7: "橙", 8: "桃",
    };
    const LANE_OPTIONS = ["内", "中", "外"];

    const validTimes = passingOrders.filter((o) => o.time_seconds != null).map((o) => o.time_seconds!);
    const baseTime = validTimes.length > 0
      ? validTimes.reduce((a, b) => a + b, 0) / validTimes.length
      : 90;

    const updates: { id: string; data: Record<string, unknown> }[] = [];
    let missingTimeOffset = 0;

    for (const order of passingOrders) {
      const data: Record<string, unknown> = {};

      if (order.time_seconds == null) {
        data.time_seconds = parseFloat(
          (baseTime + missingTimeOffset * 0.3 + Math.random() * 0.15).toFixed(2)
        );
        missingTimeOffset++;
      }
      if (order.color == null && order.gate_number != null) {
        data.color = CAP_COLOR_MAP_FE[order.gate_number] ?? "白";
      }
      if (is200m && order.lane == null) {
        data.lane = LANE_OPTIONS[Math.floor(Math.random() * 3)];
      }
      if (!is200m) {
        const o = order as any;
        if (o.absolute_speed == null) {
          data.absolute_speed = parseFloat((55 + Math.random() * 15).toFixed(1));
        }
        if (o.speed_change == null) {
          data.speed_change = parseFloat((-3 + Math.random() * 6).toFixed(1));
        }
        if (o.running_position == null) {
          data.running_position = passingOrders.indexOf(order) + 1;
        }
      }

      if (Object.keys(data).length > 0) {
        updates.push({ id: order.id, data });
      }
    }

    if (!updates.length) {
      toast({ title: "補完する欠損データがありません" });
      return;
    }

    for (const { id, data } of updates) {
      await fetch(`${API}/races/${raceId}/analysis-result/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    }
    queryClient.invalidateQueries({
      queryKey: getGetPassingOrdersQueryKey(raceId, { checkpoint: selectedCp }),
    });
    toast({ title: "欠損データを補完しました", description: `${updates.length}件を更新しました` });
  }, [selectedCp, cpType, passingOrders, raceId, queryClient, toast]);

  // Filter bboxes: hide horses whose time_seconds is null at current checkpoint
  const bboxesForCanvas = useMemo(() => {
    if (!passingOrders) return currentBboxes;
    const withTime = new Set(
      passingOrders.filter((o) => o.time_seconds != null).map((o) => o.horse_number)
    );
    return currentBboxes.filter((b) => b.horseNumber == null || withTime.has(b.horseNumber));
  }, [currentBboxes, passingOrders]);

  const raceTimeFromVideo = videoTime - effectiveVideoOffset;
  const selectedBbox = currentBboxes.find((b) => b.id === selectedBboxId) ?? null;
  const canStartCorrection = raceStatus === "待機中" || raceStatus === "修正要請" || raceStatus === "レビュー待ち" || (raceStatus === "データ確定" && isAdmin);
  const cpKeyframeCount = selectedCp ? Object.keys(keyframes[selectedCp] ?? {}).length : 0;

  // Duplicate horse number validation
  const hasDuplicateHorseNumbers = useMemo(() => {
    if (!passingOrders) return false;
    const merged = passingOrders.map((o) => ({ ...o, ...(localEdits[o.id] ?? {}) }));
    const nums = merged.map((o) => o.horse_number).filter((n) => n != null);
    return nums.length !== new Set(nums).size;
  }, [passingOrders, localEdits]);

  const duplicateHorseNumbers = useMemo(() => {
    if (!passingOrders) return new Set<number>();
    const merged = passingOrders.map((o) => ({ ...o, ...(localEdits[o.id] ?? {}) }));
    const counts: Record<number, number> = {};
    merged.forEach((o) => { if (o.horse_number != null) counts[o.horse_number] = (counts[o.horse_number] || 0) + 1; });
    return new Set(Object.entries(counts).filter(([, c]) => c > 1).map(([n]) => Number(n)));
  }, [passingOrders, localEdits]);

  const raceName = race ? `${race.venue} ${race.race_number}R ${race.race_name}` : "";

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-2 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => { if (window.history.length > 1) { window.history.back(); } else { navigate("/"); } }}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted cursor-pointer flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          {isRaceLoading ? <Skeleton className="h-6 w-64" /> : race ? (
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span className="text-muted-foreground">競馬場</span><span>{race.venue}</span>
              </div>
              <span className="text-zinc-600">·</span>
              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted-foreground">レース</span>
                <span className="font-bold">{race.race_number}R</span>
              </div>
              <span className="text-zinc-600">·</span>
              <span className="text-xs font-semibold truncate max-w-[120px]">{race.race_name}</span>
              <span className="text-zinc-600">·</span>
              <span className="text-xs text-muted-foreground">{race.distance}m</span>
              <span className="text-zinc-600">·</span>
              <span className="text-xs text-muted-foreground">{race.direction || "右回り"}</span>
              <span className="text-zinc-600">·</span>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>天候</span><span className="text-foreground">{race.weather || "-"}</span>
              </div>
              <span className="text-zinc-600">·</span>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>コース</span>
                <span className={race.surface_type === "芝" ? "text-green-400 font-medium" : "text-amber-500 font-medium"}>
                  {race.surface_type || "-"}
                </span>
              </div>
              <span className="text-zinc-600">·</span>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>馬場</span><span className="text-foreground">{race.condition || "-"}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {/* Status badge */}
          {(raceStatus === "補正中" || raceStatus === "待機中" || raceStatus === "レビュー待ち" || raceStatus === "修正要請" || raceStatus === "データ確定" || raceStatus === "再解析要請" || raceStatus === "突合失敗") && (
            <Badge
              variant="outline"
              className={`text-[10px] cursor-pointer ${
                raceStatus === "補正中" ? "border-blue-700 text-blue-400 bg-blue-900/20"
                : raceStatus === "待機中" ? "border-yellow-700 text-yellow-400 bg-yellow-900/20"
                : raceStatus === "レビュー待ち" ? "border-purple-700 text-purple-400 bg-purple-900/20"
                : raceStatus === "修正要請" ? "border-orange-700 text-orange-400 bg-orange-900/20"
                : raceStatus === "データ確定" ? "border-green-700 text-green-400 bg-green-900/20"
                : raceStatus === "再解析要請" ? "border-rose-700 text-rose-400 bg-rose-900/20"
                : raceStatus === "突合失敗" ? "border-red-700 text-red-400 bg-red-900/20"
                : "border-zinc-700 text-zinc-400"
              }`}
              onClick={() => (raceStatus === "再解析要請" || raceStatus === "修正要請") && setConfirmDialog("statusDetail")}
            >
              {raceStatus}
              {raceStatus === "再解析要請" && race?.reanalysis_reason && (
                <span className="ml-1 text-[9px]">({race.reanalysis_reason})</span>
              )}
            </Badge>
          )}

          {/* Lock indicator */}
          {raceStatus === "補正中" && isLockedByOther && (
            <Badge variant="outline" className="text-[10px] border-amber-700 text-amber-400 bg-amber-900/20">
              {raceLockedBy}が編集中
            </Badge>
          )}

          {/* 解析オプション — always visible */}
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 cursor-pointer" onClick={() => setConfirmDialog("analysisOption")}>
            解析オプション
          </Button>

          {/* 修正履歴/コメント — always visible */}
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 cursor-pointer" onClick={() => setShowHistory(true)}>
            <History className="h-3 w-3" />修正履歴/コメント
          </Button>

          {/* Editing mode buttons */}
          {isEditingMode ? (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 cursor-pointer" onClick={() => setConfirmDialog("save")}>
                <Save className="h-3 w-3" />一時保存
              </Button>
              {(() => {
                const totalMissing = Object.values(cpErrors).reduce((s, v) => s + (v?.missing ?? 0), 0);
                const totalAnomalies = Object.values(cpErrors).reduce((s, v) => s + (v?.anomalies ?? 0), 0);
                const totalIssues = totalMissing + totalAnomalies;
                const hasIssues = totalIssues > 0;
                return (
                  <Button
                    size="sm"
                    className={`h-7 text-xs gap-1.5 text-white border-0 cursor-pointer ${hasIssues ? "bg-zinc-600 opacity-50 cursor-not-allowed" : "bg-green-700 hover:bg-green-600"}`}
                    onClick={() => {
                      if (hasIssues) {
                        toast({
                          title: "チェックポイントに問題があります",
                          description: `欠損: ${totalMissing}件、異常値: ${totalAnomalies}件。修正してから補正完了にしてください。`,
                          variant: "destructive",
                        });
                        return;
                      }
                      if (hasDuplicateHorseNumbers) {
                        toast({ title: "馬番の重複があります", description: "同一地点に同じ馬番が存在します。解消してから完了してください。", variant: "destructive" });
                        return;
                      }
                      setConfirmDialog("complete");
                    }}
                    disabled={completeCorrectionMut.isPending}
                  >
                    <CheckCircle2 className="h-3 w-3" />補正完了
                    {hasIssues && (
                      <span className="ml-1 bg-red-500 text-white rounded-full text-[9px] px-1 min-w-[16px] text-center">
                        {totalIssues}
                      </span>
                    )}
                  </Button>
                );
              })()}
              <Button
                variant="ghost" size="sm"
                className="h-7 text-xs cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={handleCancel}
              >
                キャンセル
              </Button>
            </>
          ) : (
            <>
              {/* 補正開始 / 補正再開 / 再補正 — per status */}
              {canStartCorrection && !isLockedByOther && (
                <Button
                  size="sm"
                  className={`h-7 text-xs gap-1.5 cursor-pointer ${
                    raceStatus === "修正要請" ? "bg-cyan-700 hover:bg-cyan-600"
                    : raceStatus === "データ確定" ? "bg-green-700 hover:bg-green-600"
                    : "bg-primary hover:bg-primary/90"
                  } text-white border-0`}
                  onClick={handleStart}
                >
                  <Play className="h-3 w-3" />
                  {raceStatus === "修正要請" ? "補正再開"
                    : raceStatus === "データ確定" ? "補正開始"
                    : raceStatus === "レビュー待ち" ? "補正開始"
                    : "補正開始"}
                </Button>
              )}

              {/* Lock warning for non-owner */}
              {raceStatus === "補正中" && isLockedByOther && (
                <span className="text-xs text-amber-400 px-2 py-1 bg-amber-900/20 border border-amber-800/50 rounded">
                  {raceLockedBy}が編集中
                </span>
              )}

              {/* データ確定 — admin only, レビュー待ち */}
              {isAdmin && raceStatus === "レビュー待ち" && (
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5 bg-green-700 hover:bg-green-600 text-white border-0 cursor-pointer"
                  onClick={() => setConfirmDialog("confirm")}
                >
                  <CheckCircle2 className="h-3 w-3" />データ確定
                </Button>
              )}

              {/* 修正要請 — admin only, レビュー待ち */}
              {isAdmin && raceStatus === "レビュー待ち" && (
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5 bg-yellow-700 hover:bg-yellow-600 text-white border-0 cursor-pointer"
                  onClick={() => setConfirmDialog("correctionRequest")}
                >
                  修正要請
                </Button>
              )}

              {/* 修正要請 — admin only, データ確定 or レビュー待ち */}
              {isAdmin && raceStatus === "データ確定" && (
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5 bg-yellow-700 hover:bg-yellow-600 text-white border-0 cursor-pointer"
                  onClick={() => setConfirmDialog("correctionRequest")}
                >
                  修正要請
                </Button>
              )}

              {/* 強制ロック解除 — admin only, 補正中 */}
              {isAdmin && raceStatus === "補正中" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 border-amber-700 text-amber-400 hover:bg-amber-900/20 cursor-pointer"
                  onClick={() => setConfirmDialog("forceUnlock")}
                >
                  強制ロック解除
                </Button>
              )}
            </>
          )}

          {/* 突合申請 — editing mode only */}
          {isEditingMode && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 border-red-700 text-red-400 hover:bg-red-900/20 cursor-pointer"
              onClick={() => setConfirmDialog("matchingFailure")}
            >
              突合申請
            </Button>
          )}

          {/* 解析データ再紐付け — admin only, 突合失敗 status */}
          {isAdmin && raceStatus === "突合失敗" && !isEditingMode && (
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5 bg-indigo-700 hover:bg-indigo-600 text-white border-0 cursor-pointer"
              onClick={() => setConfirmDialog("bindAnalysis")}
            >
              解析データ再紐付け
            </Button>
          )}
        </div>
      </div>

      {/* 3-column body */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* LEFT: JRA公式データ (22%) */}
        <div className="w-[22%] min-w-[200px] border-r border-border flex flex-col bg-card/40">

          {/* Analysis params strip */}
          <div className="px-2.5 py-1.5 border-b border-border/60 bg-zinc-900/60 flex-shrink-0 flex items-center gap-2 flex-wrap">
            <span className="text-[9px] text-zinc-500 font-medium whitespace-nowrap">解析パラメータ</span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${race?.surface_type === "芝" ? "bg-green-900/60 text-green-400" : "bg-amber-900/60 text-amber-400"}`}>
              {race?.surface_type ?? "-"}
            </span>
            <div className="flex items-center gap-0.5 flex-wrap">
              {ANALYSIS_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setAnalysisPreset(p)}
                  className={`px-1.5 py-0.5 text-[9px] rounded cursor-pointer transition-colors border ${
                    analysisPreset === p
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                  }`}
                >{p}</button>
              ))}
            </div>
          </div>

          <div className="px-3 py-1.5 border-b border-border bg-card flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] font-semibold text-muted-foreground">JRA公式データ</span>
            <div className="flex items-center gap-0.5">
              {(["furlong", "both", "entries"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setLeftView(v)}
                  className={`px-1.5 py-0.5 text-[10px] rounded cursor-pointer transition-colors ${
                    leftView === v ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "furlong" ? "ハロン" : v === "entries" ? "出走馬" : "両方"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {(leftView === "furlong" || leftView === "both") && (
              <div className="p-2 border-b border-border/50">
                <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">ハロンタイム</div>
                {furlongSplits.length > 0 ? (
                  <div className="grid grid-cols-4 gap-0.5">
                    {furlongSplits.map((t: number, i: number) => (
                      <div key={i} className="bg-zinc-800 rounded px-1 py-0.5 text-center text-[10px] font-mono text-zinc-200">
                        {t.toFixed(1)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground text-center py-2">データなし</div>
                )}
              </div>
            )}

            {(leftView === "entries" || leftView === "both") && (
              <div>
                <div className="flex items-center gap-0.5 px-1.5 py-1 bg-muted/30 border-b border-border/50">
                  <span className="text-[9px] text-zinc-500 mr-1">並替:</span>
                  {([["horse_number", "馬番"], ["finish_position", "着順"]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setEntrySortBy(key)}
                      className={`px-1.5 py-0.5 text-[9px] rounded cursor-pointer transition-colors ${
                        entrySortBy === key ? "bg-primary text-white" : "bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >{label}</button>
                  ))}
                </div>
                <table className="w-full text-[10px]">
                  <thead className="bg-muted/60 sticky top-0 z-10">
                    <tr>
                      <th className="p-1 text-center text-muted-foreground">馬<br/>番</th>
                      <th className="p-1 text-center text-muted-foreground">枠</th>
                      <th className="p-1 text-left text-muted-foreground">馬名</th>
                      <th className="p-1 text-right text-muted-foreground">着<br/>順</th>
                      <th className="p-1 text-right text-muted-foreground">タイム</th>
                      <th className="p-1 text-right text-muted-foreground">着差</th>
                      <th className="p-1 text-right text-muted-foreground">3F</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(entries ?? [])].sort((a, b) => {
                      if (entrySortBy === "finish_position") {
                        const ap = (a as any).finish_position ?? 999;
                        const bp = (b as any).finish_position ?? 999;
                        return ap - bp;
                      }
                      return a.horse_number - b.horse_number;
                    }).map((e) => {
                      const gn = e.gate_number ?? 1;
                      const cap = CAP_COLORS[gn] ?? CAP_COLORS[1];
                      const ft = (e as any).finish_time;
                      const min = ft ? Math.floor(ft / 60) : null;
                      const sec = ft ? (ft % 60).toFixed(1) : null;
                      const timeStr = (min !== null && sec !== null) ? `${min}:${sec.padStart(4, "0")}` : "-";
                      const marginStr = formatMargin((e as any).margin, (e as any).finish_position);
                      return (
                        <tr key={e.id} className="border-t border-border/30 hover:bg-muted/20">
                          <td className="p-1 text-center font-mono font-bold">{e.horse_number}</td>
                          <td className="p-1 text-center">
                            <span
                              className="inline-flex w-4 h-4 rounded-sm items-center justify-center text-[9px] font-bold border border-white/20"
                              style={{ backgroundColor: cap.bg, color: cap.text }}
                            >{gn}</span>
                          </td>
                          <td className="p-1 truncate max-w-[60px]" title={e.horse_name}>{e.horse_name}</td>
                          <td className="p-1 text-right font-mono font-bold">{(e as any).finish_position ?? "-"}</td>
                          <td className="p-1 text-right font-mono text-muted-foreground">{timeStr}</td>
                          <td className="p-1 text-right font-mono text-muted-foreground">{marginStr}</td>
                          <td className="p-1 text-right font-mono text-muted-foreground">{(e as any).last_3f != null ? (e as any).last_3f.toFixed(1) : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        </div>

        {/* MIDDLE: Video + section buttons (38%) */}
        <div className="w-[38%] flex flex-col border-r border-border overflow-hidden">

          {/* Video area */}
          <div className="flex-shrink-0 bg-zinc-950">

            {/* Video box — full column width, 16:9 */}
            <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
              {/* Video background */}
              <div className="absolute inset-0 bg-zinc-900 overflow-hidden">
                {/* Simulated video background */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {!isEditingMode && (
                    <>
                      <Play className="h-12 w-12 text-zinc-700 mb-2" />
                      <span className="text-xs text-zinc-600">レース動画</span>
                    </>
                  )}
                  {isEditingMode && currentBboxes.length === 0 && (
                    <span className="text-xs text-zinc-600">地点を選択してBBOXを表示</span>
                  )}
                </div>

                {/* BBOX Canvas */}
                {isEditingMode && (
                  <BboxCanvas
                    bboxes={bboxesForCanvas}
                    addPreview={addPreview}
                    selectedId={selectedBboxId}
                    addMode={addMode}
                    isEditing={isEditingMode}
                    onSelect={setSelectedBboxId}
                    onAdd={handleAddBbox}
                    onUpdate={handleUpdateBbox}
                    onDelete={handleDeleteBbox}
                  />
                )}

                {/* Selected checkpoint indicator */}
                {selectedCp && !isEditingMode && (
                  <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
                    <span className="bg-black/60 text-zinc-400 text-[10px] px-2 py-0.5 rounded">
                      {selectedCp === "5m" ? "5m地点(スタート)" : selectedCp}
                    </span>
                  </div>
                )}
              </div>

              {/* Horizontal ruler (横棒) */}
              {rulerEnabled && (
                <div
                  className="absolute left-0 right-0 pointer-events-none z-10"
                  style={{ top: `${rulerY}%`, overflow: "visible" }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: "-200%",
                      right: "-200%",
                      borderTop: "2px solid rgba(249, 115, 22, 0.85)",
                      transform: `rotate(${rulerAngle}deg)`,
                      transformOrigin: "center 0",
                    }}
                  />
                </div>
              )}

              {/* Vertical ruler (縦棒) */}
              {vrulerEnabled && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none z-10"
                  style={{ left: `${vrulerX}%`, overflow: "visible" }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: "-200%",
                      bottom: "-200%",
                      borderLeft: "2px solid rgba(59, 130, 246, 0.85)",
                      transform: `rotate(${vrulerAngle}deg)`,
                      transformOrigin: "center center",
                    }}
                  />
                </div>
              )}

              {/* Time overlay */}
              <div className="absolute top-1.5 right-1.5 bg-black/75 rounded px-1.5 py-0.5 pointer-events-none z-20">
                <div className="text-[9px] text-zinc-400">動画: {fmtVideoTime(videoTime)}</div>
                <div className="text-[9px] text-red-400 font-mono">
                  レース: {raceTimeFromVideo < 0
                    ? `-${fmtTime(Math.abs(raceTimeFromVideo))}`
                    : fmtTime(raceTimeFromVideo)}
                </div>
                {isEditingMode && (
                  <div className="text-[9px] text-zinc-500 font-mono">
                    F: {currentFrame} {cpKeyframeCount > 0 && <span className="text-primary">KF:{cpKeyframeCount}</span>}
                  </div>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="px-2 pt-1.5 pb-1 space-y-1 bg-zinc-950">
              {/* Playback row */}
              <div className="flex items-center gap-1.5 justify-between">
                <div className="flex items-center gap-1">
                  <button onClick={() => setVideoTime(0)} className="text-zinc-400 hover:text-white cursor-pointer p-0.5">
                    <ChevronFirst className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setVideoTime((t) => Math.max(0, t - 1 / 30))} className="text-zinc-400 hover:text-white cursor-pointer p-0.5">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="bg-primary/20 hover:bg-primary/40 text-primary border border-primary/40 rounded p-1 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => setVideoTime((t) => Math.min(totalVideoSec, t + 1 / 30))} className="text-zinc-400 hover:text-white cursor-pointer p-0.5">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setVideoTime(totalVideoSec)} className="text-zinc-400 hover:text-white cursor-pointer p-0.5">
                    <ChevronLast className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  {PLAY_SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setPlaySpeed(s)}
                      className={`text-[10px] px-1.5 py-0.5 rounded border cursor-pointer ${
                        playSpeed === s ? "bg-primary/20 border-primary text-primary" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                      }`}
                    >×{s}</button>
                  ))}
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-zinc-500 font-mono w-8 text-right">{fmtVideoTime(videoTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={totalVideoSec}
                  step={0.033}
                  value={videoTime}
                  onChange={(e) => setVideoTime(parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-orange-500 cursor-pointer"
                />
                <span className="text-[9px] text-zinc-500 font-mono w-8">{fmtVideoTime(totalVideoSec)}</span>
              </div>

              {/* Start / Goal time row */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-zinc-500">スタート</span>
                  <input
                    type="text"
                    value={startTimeInput}
                    onChange={(e) => setStartTimeInput(e.target.value)}
                    onBlur={(e) => {
                      const v = parseTimeInput(e.target.value);
                      if (v !== null && v >= 0) {
                        setCustomVideoOffset(v);
                        setStartTimeInput(fmtTime(v));
                      } else {
                        setStartTimeInput(fmtTime(effectiveVideoOffset));
                      }
                    }}
                    className="w-[70px] bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-200 focus:border-primary focus:outline-none"
                    placeholder="0:07.30"
                    title="動画内のレーススタート時刻"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-zinc-500">ゴール</span>
                  <input
                    type="text"
                    value={goalTimeInput}
                    onChange={(e) => setGoalTimeInput(e.target.value)}
                    onBlur={(e) => {
                      const v = parseTimeInput(e.target.value);
                      if (v !== null && v > 0) {
                        setCustomRaceDuration(v);
                        setGoalTimeInput(fmtTime(v));
                      } else {
                        setGoalTimeInput(fmtTime(effectiveBaseSec));
                      }
                    }}
                    className="w-[70px] bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-200 focus:border-primary focus:outline-none"
                    placeholder="1:34.20"
                    title="レースのゴールタイム（スタートからの経過時間）"
                  />
                </div>
                {(customVideoOffset !== null || customRaceDuration !== null) && (
                  <button
                    onClick={() => {
                      const computed = race ? (race.distance / 1000) * 60 + 27 : 90;
                      setCustomVideoOffset(null);
                      setCustomRaceDuration(null);
                      setStartTimeInput(fmtTime(VIDEO_OFFSET));
                      setGoalTimeInput(fmtTime(computed));
                    }}
                    className="text-[9px] text-zinc-500 hover:text-zinc-300 cursor-pointer underline"
                    title="デフォルトに戻す"
                  >
                    リセット
                  </button>
                )}
              </div>

              {/* Ruler + BBOX toolbar row */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Horizontal ruler (横棒) */}
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rulerEnabled}
                    onChange={(e) => setRulerEnabled(e.target.checked)}
                    className="cursor-pointer accent-orange-500"
                  />
                  <Ruler className="h-3 w-3 text-zinc-400" />
                  <span className="text-[10px] text-zinc-400">横棒</span>
                </label>
                {rulerEnabled && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-zinc-500">位置</span>
                      <input
                        type="range" min={0} max={100} value={rulerY}
                        onChange={(e) => setRulerY(parseInt(e.target.value))}
                        className="w-16 h-1 accent-orange-500 cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-zinc-500">角度</span>
                      <input
                        type="range" min={-45} max={45} value={rulerAngle}
                        onChange={(e) => setRulerAngle(parseInt(e.target.value))}
                        className="w-16 h-1 accent-orange-500 cursor-pointer"
                      />
                      <span className="text-[9px] text-zinc-500 w-6">{rulerAngle}°</span>
                    </div>
                  </>
                )}

                {/* Vertical ruler (縦棒) */}
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={vrulerEnabled}
                    onChange={(e) => setVrulerEnabled(e.target.checked)}
                    className="cursor-pointer accent-blue-500"
                  />
                  <span className="text-[10px] text-zinc-400">縦棒</span>
                </label>
                {vrulerEnabled && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-zinc-500">位置</span>
                      <input
                        type="range" min={0} max={100} value={vrulerX}
                        onChange={(e) => setVrulerX(parseInt(e.target.value))}
                        className="w-16 h-1 accent-blue-500 cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-zinc-500">角度</span>
                      <input
                        type="range" min={-45} max={45} value={vrulerAngle}
                        onChange={(e) => setVrulerAngle(parseInt(e.target.value))}
                        className="w-16 h-1 accent-blue-500 cursor-pointer"
                      />
                      <span className="text-[9px] text-zinc-500 w-6">{vrulerAngle}°</span>
                    </div>
                  </>
                )}

                {/* BBOX toolbar — only in editing mode */}
                {isEditingMode && selectedCp && (
                  <div className="flex items-center gap-1 ml-auto">
                    <button
                      onClick={() => { setAddMode((m) => !m); setSelectedBboxId(null); }}
                      title="BBOX追加"
                      className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] cursor-pointer transition-colors ${
                        addMode ? "bg-primary/20 border-primary text-primary" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                      }`}
                    >
                      <Square className="h-3 w-3" />追加
                    </button>
                    <button
                      onClick={() => { if (selectedBboxId) handleDeleteBbox(selectedBboxId); }}
                      disabled={!selectedBboxId}
                      title="選択BBOX削除"
                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:border-red-500 hover:text-red-400 text-[10px] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="h-3 w-3" />削除
                    </button>
                    <button
                      onClick={handleSaveKeyframe}
                      title="キーフレーム保存"
                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:border-blue-500 hover:text-blue-400 text-[10px] cursor-pointer"
                    >
                      <Save className="h-3 w-3" />KF
                    </button>
                    <button
                      onClick={handleRecalculate}
                      title="座標から通過タイムを再計算"
                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:border-green-500 hover:text-green-400 text-[10px] cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" />再計算
                    </button>
                  </div>
                )}
              </div>

              {/* Selected BBOX assignment panel */}
              {isEditingMode && selectedBbox && (
                <div className="flex items-center gap-2 px-2 py-1 bg-zinc-800/60 rounded border border-zinc-700/50">
                  <MousePointer2 className="h-3 w-3 text-primary flex-shrink-0" />
                  <span className="text-[10px] text-zinc-400">選択BBOX</span>
                  <select
                    value={selectedBbox.horseNumber ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleBboxHorseNumber(selectedBbox.id, val ? parseInt(val) : null);
                    }}
                    className="bg-zinc-900 border border-zinc-600 rounded text-[10px] px-1.5 py-0.5 cursor-pointer text-foreground"
                  >
                    <option value="">未割当</option>
                    {Array.from({ length: numHorses }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{i + 1}番</option>
                    ))}
                  </select>
                  {selectedBbox.gateNumber && (
                    <span
                      className="inline-flex w-5 h-5 rounded-sm items-center justify-center text-[9px] font-bold border border-white/20 flex-shrink-0"
                      style={{
                        backgroundColor: CAP_COLORS[selectedBbox.gateNumber]?.bg ?? "#555",
                        color: CAP_COLORS[selectedBbox.gateNumber]?.text ?? "#fff",
                      }}
                    >
                      {selectedBbox.gateNumber}
                    </span>
                  )}
                  <span className="text-[9px] text-zinc-600 font-mono ml-auto">
                    ({(selectedBbox.x * 100).toFixed(0)}%,{(selectedBbox.y * 100).toFixed(0)}%) {(selectedBbox.w * 100).toFixed(0)}×{(selectedBbox.h * 100).toFixed(0)}
                  </span>
                </div>
              )}
              {isEditingMode && addMode && !selectedBbox && (
                <div className="text-[10px] text-primary/80 px-1 animate-pulse">
                  ドラッグしてBBOXを追加してください
                </div>
              )}
            </div>
          </div>

          {/* Section buttons */}
          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            {race && (
              <>
                <div>
                  <div className="text-[10px] text-muted-foreground font-medium mb-1.5">200m毎の地点</div>
                  <div className="flex flex-wrap gap-1.5">
                    {pts200.map((pt) => {
                      const vt = cpVideoTime(pt.meter, race.distance, effectiveBaseSec, effectiveVideoOffset);
                      const isSelected = selectedCp === pt.key;
                      const cpData = cpErrors[pt.key];
                      const missingCount = cpData?.missing ?? 0;
                      const anomalyCount = cpData?.anomalies ?? 0;
                      const hasMissing = missingCount > 0;
                      const hasAnomaly = anomalyCount > 0;
                      const hasIssue = hasMissing || hasAnomaly;
                      return (
                        <button
                          key={pt.key}
                          onClick={() => handleCpClick(pt.key, pt.meter)}
                          className={`relative flex flex-col items-center px-2 py-1 rounded border text-[10px] cursor-pointer transition-colors min-w-[48px] ${
                            isSelected
                              ? "bg-primary border-primary text-white"
                              : hasMissing
                                ? "bg-red-950/40 border-red-700/70 text-foreground hover:border-red-500"
                                : hasAnomaly
                                  ? "bg-yellow-950/30 border-yellow-700/60 text-foreground hover:border-yellow-500"
                                  : "bg-card border-border text-foreground hover:border-primary/50 hover:bg-muted/40"
                          }`}
                        >
                          {anomalyCount > 0 && (
                            <span className="absolute -top-1.5 -left-1.5 min-w-[14px] h-[14px] bg-yellow-500 text-black text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 z-10">
                              {anomalyCount}
                            </span>
                          )}
                          {missingCount > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] bg-red-600 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 z-10">
                              {missingCount}
                            </span>
                          )}
                          <span className="font-medium leading-tight whitespace-pre-line text-center text-[9px]">{pt.label}</span>
                          <span className={`mt-0.5 font-mono text-[9px] ${isSelected ? "text-white/70" : "text-muted-foreground"}`}>
                            {fmtVideoTime(vt)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
                    <span>最後の直線</span>
                    <span className="text-[9px] text-zinc-600">{straight}m</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ptsStr.map((pt) => {
                      const vt = cpVideoTime(pt.meter, race.distance, effectiveBaseSec, effectiveVideoOffset);
                      const isSelected = selectedCp === pt.key;
                      const cpData = cpErrors[pt.key];
                      const missingCount = cpData?.missing ?? 0;
                      const anomalyCount = cpData?.anomalies ?? 0;
                      const hasMissing = missingCount > 0;
                      const hasAnomaly = anomalyCount > 0;
                      return (
                        <button
                          key={pt.key}
                          onClick={() => handleCpClick(pt.key, pt.meter)}
                          className={`relative flex flex-col items-center px-2 py-1 rounded border text-[10px] cursor-pointer transition-colors min-w-[48px] ${
                            isSelected
                              ? "bg-orange-600 border-orange-500 text-white"
                              : hasMissing
                                ? "bg-red-950/40 border-red-700/70 text-foreground hover:border-red-500"
                                : hasAnomaly
                                  ? "bg-yellow-950/30 border-yellow-700/60 text-foreground hover:border-yellow-500"
                                  : "bg-card border-border text-foreground hover:border-orange-500/50 hover:bg-muted/40"
                          }`}
                        >
                          {anomalyCount > 0 && (
                            <span className="absolute -top-1.5 -left-1.5 min-w-[14px] h-[14px] bg-yellow-500 text-black text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 z-10">
                              {anomalyCount}
                            </span>
                          )}
                          {missingCount > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] bg-red-600 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 z-10">
                              {missingCount}
                            </span>
                          )}
                          <span className="font-medium text-[9px]">{pt.label}</span>
                          <span className={`mt-0.5 font-mono text-[9px] ${isSelected ? "text-white/70" : "text-muted-foreground"}`}>
                            {fmtVideoTime(vt)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* RIGHT: Analysis results (40%) */}
        <div className="w-[40%] flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-border bg-card flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">通過順位データ</span>
              {selectedCp && (
                <Badge variant="outline" className="text-[10px] border-primary/50 text-primary">
                  {selectedCp === "5m" ? "5m地点(スタート)" : selectedCp}
                </Badge>
              )}
            </div>
            {selectedCp && (
              <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                <span className="text-green-400">● 90%以上</span>
                <span className="text-yellow-400">● 75-89%</span>
                <span className="text-red-400">● 75%未満</span>
              </div>
            )}
          </div>

          {!selectedCp ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Clock className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">区間ボタンを選択してください</p>
                <p className="text-xs text-zinc-600 mt-1">左の動画エリアで地点を選ぶと解析結果が表示されます</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              {isOrdersLoading ? (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 14 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
                </div>
              ) : (
                <RightTable
                  cpType={cpType!}
                  orders={displayOrders}
                  entries={entries ?? []}
                  numHorses={numHorses}
                  isCorrectionMode={isEditingMode}
                  onEdit={setEdit}
                  duplicateHorseNumbers={duplicateHorseNumbers}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showHistory && (
        <HistoryModal
          raceId={raceId}
          onClose={() => setShowHistory(false)}
          correctionRequestComment={race?.correction_request_comment}
          isEditingMode={isEditingMode}
          onRestore={handleRestore}
        />
      )}

      {confirmDialog === "save" && (
        <TempSaveDialog
          onCancel={() => setConfirmDialog(null)}
          onSaveAndContinue={handleTempSaveContinue}
          onSaveAndExit={handleTempSaveExit}
          loading={savingTemp}
        />
      )}
      {confirmDialog === "complete" && (
        <ConfirmDialog
          title="補正完了の確認"
          message="補正を完了しますか？ステータスがレビュー待ちに変わります。"
          confirmLabel="補正完了"
          onConfirm={handleComplete}
          onCancel={() => setConfirmDialog(null)}
          loading={completeCorrectionMut.isPending}
        />
      )}
      {confirmDialog === "cancel" && (
        <ConfirmDialog
          title="編集キャンセルの確認"
          message="未保存の変更があります。キャンセルすると変更が失われます。"
          confirmLabel="キャンセル"
          onConfirm={doCancel}
          onCancel={() => setConfirmDialog(null)}
          confirmColor="bg-red-700 hover:bg-red-600"
        />
      )}
      {confirmDialog === "confirm" && (
        <ConfirmDialog
          title="データ確定の確認"
          message="このレースのデータを確定しますか？確定後は変更できません。"
          confirmLabel="データ確定"
          onConfirm={handleConfirm}
          onCancel={() => setConfirmDialog(null)}
          confirmColor="bg-green-700 hover:bg-green-600"
        />
      )}
      {confirmDialog === "forceUnlock" && (
        <ConfirmDialog
          title="強制ロック解除の確認"
          message={`${raceLockedBy}のロックを強制的に解除しますか？`}
          confirmLabel="強制解除"
          onConfirm={handleForceUnlock}
          onCancel={() => setConfirmDialog(null)}
          confirmColor="bg-amber-700 hover:bg-amber-600"
        />
      )}
      {confirmDialog === "matchingFailure" && (
        <ConfirmDialog
          title="突合申請の確認"
          message="このレースを突合失敗として報告しますか？"
          confirmLabel="突合申請"
          onConfirm={handleMatchingFailure}
          onCancel={() => setConfirmDialog(null)}
          confirmColor="bg-red-700 hover:bg-red-600"
        />
      )}
      {confirmDialog === "correctionRequest" && (
        <CorrectionRequestDialog
          raceName={raceName}
          onCancel={() => setConfirmDialog(null)}
          onSubmit={handleCorrectionRequest}
        />
      )}
      {confirmDialog === "statusDetail" && race && (
        <StatusDetailPopup
          race={race}
          onClose={() => setConfirmDialog(null)}
        />
      )}
      {confirmDialog === "bindAnalysis" && (
        <BindAnalysisDialog
          raceId={raceId}
          raceName={raceName}
          onCancel={() => setConfirmDialog(null)}
          onBind={handleBindAnalysis}
        />
      )}
      {confirmDialog === "analysisOption" && (
        <AnalysisOptionDialog
          raceId={raceId}
          raceName={raceName}
          isAdmin={isAdmin}
          onCancel={() => setConfirmDialog(null)}
          onSaved={() => {
            setConfirmDialog(null);
            toast({ title: "解析オプションを保存しました" });
          }}
          onReanalyze={async () => {
            try {
              const res = await fetch(`${API}/races/${raceId}/reanalyze`, { method: "POST" });
              if (!res.ok) throw new Error("Failed");
              const updated = await res.json();
              queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
              toast({ title: "再解析を実行しました" });
              setConfirmDialog(null);
            } catch {
              toast({ title: "再解析に失敗しました", variant: "destructive" });
            }
          }}
          onReanalysisRequest={handleReanalysisRequest}
        />
      )}
    </div>
  );
}

// ── Right Table ────────────────────────────────────────────────────────────────
function RightTable({
  cpType, orders, entries, numHorses, isCorrectionMode, onEdit, duplicateHorseNumbers,
}: {
  cpType: "start" | "200m" | "straight";
  orders: any[];
  entries: any[];
  numHorses: number;
  isCorrectionMode: boolean;
  onEdit: (id: string, field: string, value: unknown) => void;
  duplicateHorseNumbers?: Set<number>;
}) {
  const presentNums = new Set(orders.map((o) => o.horse_number));
  const missingHorses = entries.map((e) => e.horse_number).filter((n) => !presentNums.has(n));
  const phantomRows = missingHorses.map((hn) => {
    const e = entries.find((x) => x.horse_number === hn);
    return {
      id: `phantom-${hn}`, position: null, horse_number: hn,
      gate_number: e?.gate_number ?? null, color: null, lane: null,
      time_seconds: null, accuracy: null, special_note: null,
      running_position: null, absolute_speed: null, speed_change: null,
      is_phantom: true,
    };
  });

  // Sort real rows by time_seconds ASC (null → bottom), then phantoms at end
  const sortedOrders = [...orders].sort((a, b) => {
    if (a.time_seconds == null && b.time_seconds == null) return 0;
    if (a.time_seconds == null) return 1;
    if (b.time_seconds == null) return -1;
    return a.time_seconds - b.time_seconds;
  });
  const allRows = [...sortedOrders, ...phantomRows];

  // Dense rank by time_seconds (1/100s precision, null → no rank, ties share rank)
  const timeRankMap = useMemo(() => {
    const withTime = allRows
      .filter((r) => !(r as any).is_phantom && r.time_seconds != null)
      .map((r) => ({ id: r.id, t: Math.round(r.time_seconds * 100) }))
      .sort((a, b) => a.t - b.t);
    const map: Record<string, number> = {};
    let rank = 1;
    for (let i = 0; i < withTime.length; i++) {
      if (i > 0 && withTime[i].t !== withTime[i - 1].t) rank = i + 1;
      map[withTime[i].id] = rank;
    }
    return map;
  }, [allRows]);

  const hasRowError = (row: any) => {
    if ((row as any).is_phantom) return false;
    const isExempt = row.special_note != null && EXEMPT_SPECIAL_NOTES.has(row.special_note);
    if (row.horse_number == null) return true;
    if (row.gate_number == null) return true;
    if (row.time_seconds == null && !isExempt) return true;
    if (row.time_seconds != null && (row.time_seconds > 300 || row.time_seconds < 0.05)) return true;
    if (row.accuracy != null && row.accuracy < 30) return true;
    if (row.lane == null && !isExempt && cpType === "200m") return true;
    if (row.absolute_speed != null && row.absolute_speed > 80) return true;
    if (row.speed_change != null && Math.abs(row.speed_change) > 30) return true;
    return false;
  };

  const isTimeAnomaly = (t: number | null) => t != null && (t > 300 || t < 0.05);
  const isSpeedAnomaly = (s: number | null) => s != null && s > 80;
  const isSpeedChangeAnomaly = (sc: number | null) => sc != null && Math.abs(sc) > 30;

  return (
    <table className="w-full text-xs">
      <thead className="bg-muted/60 sticky top-0 z-10">
        <tr>
          <th className="p-1.5 text-center text-muted-foreground text-[10px]">順位</th>
          <th className="p-1.5 text-center text-muted-foreground text-[10px]">馬番</th>
          <th className="p-1.5 text-center text-muted-foreground text-[10px]">枠</th>
          <th className="p-1.5 text-center text-muted-foreground text-[10px]">帽色</th>
          <th className="p-1.5 text-left text-muted-foreground text-[10px]">馬名</th>
          <th className="p-1.5 text-right text-muted-foreground text-[10px]">通過タイム</th>
          {cpType === "200m" && <th className="p-1.5 text-center text-muted-foreground text-[10px]">レーン</th>}
          {cpType === "straight" && (
            <>
              <th className="p-1.5 text-right text-muted-foreground text-[10px]">推定速度</th>
              <th className="p-1.5 text-right text-muted-foreground text-[10px]">推定速度変化</th>
              <th className="p-1.5 text-center text-muted-foreground text-[10px]">走行位置</th>
            </>
          )}
          <th className="p-1.5 text-center text-muted-foreground text-[10px]">特記事項</th>
          <th className="p-1.5 text-center text-muted-foreground text-[10px]">信頼度</th>
        </tr>
      </thead>
      <tbody>
        {allRows.map((row, idx) => {
          const isPhantom = (row as any).is_phantom;
          const hn = row.horse_number;
          const gn = row.gate_number;
          const cap = gn != null ? CAP_COLORS[gn] : null;
          const isDuplicate = hn != null && duplicateHorseNumbers?.has(hn);
          const entryForRow = hn != null ? entries.find((e) => e.horse_number === hn) : null;
          const horseName = entryForRow?.horse_name ?? null;
          const rowError = hasRowError(row);

          const rowBg = isPhantom
            ? "opacity-50"
            : isDuplicate
              ? "bg-red-900/20 hover:bg-red-900/30"
              : rowError
                ? "bg-amber-900/20 hover:bg-amber-900/30"
                : "hover:bg-muted/20";

          const rowLeftBorder = isPhantom
            ? ""
            : isDuplicate
              ? "border-l-2 border-l-red-500"
              : rowError
                ? "border-l-2 border-l-amber-500"
                : "";

          return (
            <tr key={row.id ?? idx} className={`border-t border-border/30 ${rowBg} ${rowLeftBorder}`}>
              <td className="p-1.5 text-center font-mono font-bold text-sm">
                {!isPhantom && timeRankMap[row.id] != null
                  ? timeRankMap[row.id]
                  : <span className="text-zinc-600">-</span>}
              </td>

              <td className={`p-1.5 text-center ${isDuplicate ? "ring-1 ring-red-500 rounded" : !isPhantom && hn == null ? "bg-red-900/30" : ""}`}>
                {isCorrectionMode && !isPhantom ? (
                  <select
                    value={hn ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      onEdit(row.id, "horse_number", v ? parseInt(v, 10) : null);
                    }}
                    className={`bg-zinc-800 border rounded text-[10px] px-1 py-0.5 cursor-pointer text-foreground w-10 ${isDuplicate ? "border-red-500 text-red-400" : hn == null ? "border-red-500" : "border-zinc-600"}`}
                  >
                    <option value="">-</option>
                    {Array.from({ length: numHorses }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{i + 1}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`font-mono font-bold ${isDuplicate ? "text-red-400" : !isPhantom && hn == null ? "text-red-400" : ""}`}>{hn ?? <span className="text-red-400 font-bold">欠損</span>}</span>
                )}
                {isDuplicate && <span className="text-[8px] text-red-400 block">重複</span>}
              </td>

              <td className="p-1.5 text-center">
                {gn != null ? (
                  <span
                    className="inline-flex w-5 h-5 rounded-sm items-center justify-center text-[10px] font-bold border border-white/20"
                    style={{ backgroundColor: cap?.bg ?? "#333", color: cap?.text ?? "#fff" }}
                  >{gn}</span>
                ) : <span className="text-zinc-600">-</span>}
              </td>

              <td className={`p-1.5 text-center ${!isCorrectionMode && !isPhantom && gn == null ? "bg-red-900/30" : ""}`}>
                {isCorrectionMode && !isPhantom ? (
                  <select
                    value={gn ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) onEdit(row.id, "gate_number", parseInt(v, 10));
                    }}
                    className="text-[10px] rounded border border-zinc-600 cursor-pointer px-0.5 py-0.5"
                    style={{
                      backgroundColor: gn != null ? CAP_COLORS[gn]?.bg : "#333",
                      color: gn != null ? CAP_COLORS[gn]?.text : "#fff",
                      minWidth: "36px",
                    }}
                  >
                    {Object.entries(CAP_COLORS).map(([k, c]) => (
                      <option key={k} value={k} style={{ backgroundColor: c.bg, color: c.text }}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                ) : !isPhantom && gn == null ? (
                  <span className="text-red-400 font-bold">欠損</span>
                ) : (
                  <CapCircle gate={gn} />
                )}
              </td>

              <td className="p-1.5 text-left text-[10px] text-zinc-200 max-w-[80px] truncate" title={horseName ?? ""}>
                {horseName ?? <span className="text-zinc-600">-</span>}
              </td>

              <td className={`p-1.5 text-right font-mono text-[10px] ${!isPhantom && row.time_seconds == null ? "bg-red-900/30" : isTimeAnomaly(row.time_seconds) ? "bg-amber-900/40" : ""}`}>
                {isCorrectionMode && !isPhantom ? (
                  <input
                    type="text"
                    defaultValue={row.time_seconds != null ? row.time_seconds.toFixed(2) : ""}
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) onEdit(row.id, "time_seconds", v);
                      else if (e.target.value === "") onEdit(row.id, "time_seconds", null);
                    }}
                    placeholder="欠損"
                    className={`w-16 bg-zinc-800 border rounded text-[10px] px-1 py-0.5 text-right font-mono text-foreground ${row.time_seconds == null ? "border-red-500 placeholder-red-500" : "border-zinc-600"}`}
                  />
                ) : row.time_seconds != null ? (
                  <span className={isTimeAnomaly(row.time_seconds) ? "text-amber-400 font-bold" : ""}>
                    {row.time_seconds.toFixed(2)}s
                  </span>
                ) : !isPhantom ? (
                  <span className="text-red-400 font-bold">欠損</span>
                ) : <span className="text-zinc-600">-</span>}
              </td>

              {cpType === "200m" && (
                <td className={`p-1.5 text-center ${row.lane == null && !isPhantom ? "bg-red-900/30" : ""}`}>
                  {isCorrectionMode && !isPhantom ? (
                    <select
                      value={row.lane ?? "中"}
                      onChange={(e) => onEdit(row.id, "lane", e.target.value)}
                      className={`bg-zinc-800 border rounded text-[10px] px-1 py-0.5 cursor-pointer text-foreground ${row.lane == null ? "border-red-500" : "border-zinc-600"}`}
                    >
                      {LANES.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  ) : (
                    <span className={row.lane == null ? "text-red-400 font-bold" : "text-muted-foreground"}>
                      {row.lane ?? "欠損"}
                    </span>
                  )}
                </td>
              )}

              {cpType === "straight" && (
                <>
                  <td className={`p-1.5 text-right font-mono text-[10px] ${isSpeedAnomaly(row.absolute_speed) ? "bg-amber-900/40" : !isPhantom && row.absolute_speed == null ? "bg-red-900/30" : ""}`}>
                    {isCorrectionMode && !isPhantom ? (
                      <input
                        type="number"
                        step="0.1"
                        defaultValue={row.absolute_speed ?? ""}
                        onBlur={(e) => onEdit(row.id, "absolute_speed", e.target.value === "" ? null : parseFloat(e.target.value))}
                        placeholder="欠損"
                        className={`w-14 bg-zinc-800 border rounded text-[10px] px-1 py-0.5 text-right font-mono text-foreground ${row.absolute_speed == null ? "border-red-500 placeholder-red-500" : "border-zinc-600"}`}
                      />
                    ) : row.absolute_speed != null ? (
                      <span className={isSpeedAnomaly(row.absolute_speed) ? "text-amber-400 font-bold" : "text-cyan-400"}>
                        {row.absolute_speed.toFixed(1)}
                      </span>
                    ) : !isPhantom ? (
                      <span className="text-red-400 font-bold">欠損</span>
                    ) : <span className="text-zinc-600">-</span>}
                  </td>
                  <td className={`p-1.5 text-right font-mono text-[10px] ${isSpeedChangeAnomaly(row.speed_change) ? "bg-amber-900/40" : !isPhantom && row.speed_change == null ? "bg-red-900/30" : ""}`}>
                    {isCorrectionMode && !isPhantom ? (
                      <input
                        type="number"
                        step="0.1"
                        defaultValue={row.speed_change ?? ""}
                        onBlur={(e) => onEdit(row.id, "speed_change", e.target.value === "" ? null : parseFloat(e.target.value))}
                        placeholder="欠損"
                        className={`w-14 bg-zinc-800 border rounded text-[10px] px-1 py-0.5 text-right font-mono text-foreground ${row.speed_change == null ? "border-red-500 placeholder-red-500" : "border-zinc-600"}`}
                      />
                    ) : row.speed_change != null ? (
                      <span className={isSpeedChangeAnomaly(row.speed_change) ? "text-amber-400 font-bold" : row.speed_change >= 0 ? "text-green-400" : "text-red-400"}>
                        {row.speed_change >= 0 ? "+" : ""}{row.speed_change.toFixed(1)}
                      </span>
                    ) : !isPhantom ? (
                      <span className="text-red-400 font-bold">欠損</span>
                    ) : <span className="text-zinc-600">-</span>}
                  </td>
                  <td className={`p-1.5 text-center ${!isPhantom && row.running_position == null ? "bg-red-900/30" : ""}`}>
                    {isCorrectionMode && !isPhantom ? (
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          onClick={() => onEdit(row.id, "running_position", Math.max(0, (row.running_position ?? 1) - 1))}
                          className="w-4 h-4 flex items-center justify-center bg-zinc-700 rounded text-zinc-300 hover:bg-zinc-600 cursor-pointer text-[10px]"
                        ><Minus className="h-2.5 w-2.5" /></button>
                        <span className="w-6 text-center font-mono text-[10px]">{row.running_position ?? "-"}</span>
                        <button
                          onClick={() => onEdit(row.id, "running_position", (row.running_position ?? 0) + 1)}
                          className="w-4 h-4 flex items-center justify-center bg-zinc-700 rounded text-zinc-300 hover:bg-zinc-600 cursor-pointer text-[10px]"
                        ><Plus className="h-2.5 w-2.5" /></button>
                      </div>
                    ) : !isPhantom && row.running_position == null ? (
                      <span className="text-red-400 font-bold">欠損</span>
                    ) : (
                      <span className="text-muted-foreground text-[10px]">
                        {row.running_position != null ? `${row.running_position}頭目` : "-"}
                      </span>
                    )}
                  </td>
                </>
              )}

              <td className="p-1.5 text-center">
                {isCorrectionMode && !isPhantom ? (
                  <select
                    value={row.special_note ?? "ー"}
                    onChange={(e) => onEdit(row.id, "special_note", e.target.value === "ー" ? null : e.target.value)}
                    className="bg-zinc-800 border border-zinc-600 rounded text-[10px] px-1 py-0.5 cursor-pointer text-foreground max-w-[80px]"
                  >
                    {SPECIAL_NOTES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                ) : (
                  <span className={`text-[10px] ${row.special_note && row.special_note !== "ー" ? "text-yellow-400" : "text-zinc-600"}`}>
                    {row.special_note || "-"}
                  </span>
                )}
              </td>

              <td className={`p-1.5 text-center ${row.accuracy != null && row.accuracy < 30 ? "bg-red-900/30" : ""}`}>
                <AccBadge v={row.accuracy} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
