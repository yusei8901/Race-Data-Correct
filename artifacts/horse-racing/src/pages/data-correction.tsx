import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Play, Pause, SkipBack, ChevronFirst, ChevronLast,
  History, CheckCircle2, Save, Clock, Minus, Plus, Ruler,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRace, getGetRaceQueryKey,
  useGetRaceEntries, getGetRaceEntriesQueryKey,
  useGetPassingOrders, getGetPassingOrdersQueryKey,
  useStartCorrection, useCompleteCorrection,
  useUpdatePassingOrder,
} from "@workspace/api-client-react";
import type { Race } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/contexts/user-role";

// ── Constants ──────────────────────────────────────────────────────────────
const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE_URL}/fastapi`;

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
const LANES = ["内", "中", "外"];
const PLAY_SPEEDS = [0.5, 1.0, 1.5, 2.0];
const VIDEO_OFFSET = 7.30; // race time offset in seconds

// ── Helpers ─────────────────────────────────────────────────────────────────
function getStraight(race: Race): number {
  const key = `${race.venue}${race.surface_type}`;
  return STRAIGHT_MAP[key] || 300;
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

function cpVideoTime(meter: number, distance: number, baseSec: number): number {
  if (meter <= 5) return VIDEO_OFFSET;
  if (meter >= distance) return VIDEO_OFFSET + baseSec;
  return VIDEO_OFFSET + baseSec * (meter / distance);
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

// ── History Modal ────────────────────────────────────────────────────────────
interface HistoryEntry {
  id: string;
  user_name: string;
  action_type: string;
  description?: string;
  created_at: string;
}

function HistoryModal({ raceId, onClose }: { raceId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/races/${raceId}/history`)
      .then((r) => r.json())
      .then((d) => { setEntries(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [raceId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[560px] max-w-[95vw] flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">修正履歴</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading ? (
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
                        e.action_type === "補正完了" || e.action_type === "データ確定"
                          ? "bg-green-900/50 text-green-400"
                          : e.action_type === "補正開始"
                          ? "bg-blue-900/50 text-blue-400"
                          : "bg-zinc-700 text-zinc-300"
                      }`}>{e.action_type}</span>
                    </td>
                    <td className="p-2 text-muted-foreground">{e.description || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Confirm Dialog ───────────────────────────────────────────────────────────
function ConfirmDialog({
  title, message, confirmLabel, onConfirm, onCancel, loading,
}: {
  title: string; message: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[400px] max-w-[95vw] p-6">
        <h2 className="text-sm font-semibold mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground mb-5">{message}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading} className="h-8 text-xs cursor-pointer">キャンセル</Button>
          <Button size="sm" onClick={onConfirm} disabled={loading} className="h-8 text-xs cursor-pointer bg-primary hover:bg-primary/90">
            {loading ? "処理中..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DataCorrection() {
  const params = useParams();
  const raceId = params.raceId as string;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useUserRole();

  // ── UI state
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<"save" | "complete" | null>(null);
  const [leftView, setLeftView] = useState<"furlong" | "entries" | "both">("both");
  const [selectedCp, setSelectedCp] = useState<string | null>(null);

  // ── Video state (mock)
  const [videoTime, setVideoTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1.0);
  const [rulerEnabled, setRulerEnabled] = useState(false);
  const [rulerY, setRulerY] = useState(50);
  const [rulerAngle, setRulerAngle] = useState(0);

  // ── Local edits for correction
  const [localEdits, setLocalEdits] = useState<Record<string, Record<string, unknown>>>({});

  // ── Video timer (mock playback)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setVideoTime((t) => {
          const next = t + 0.1 * playSpeed;
          if (next >= 120) { setIsPlaying(false); return 120; }
          return next;
        });
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPlaying, playSpeed]);

  // ── API hooks
  const { data: race, isLoading: isRaceLoading } = useGetRace(raceId, {
    query: { enabled: !!raceId, queryKey: getGetRaceQueryKey(raceId) },
  });

  const { data: entries } = useGetRaceEntries(raceId, {
    query: { enabled: !!raceId, queryKey: getGetRaceEntriesQueryKey(raceId) },
  });

  const { data: passingOrders, isLoading: isOrdersLoading } = useGetPassingOrders(
    raceId,
    { checkpoint: selectedCp ?? undefined },
    { query: { enabled: !!raceId && !!selectedCp, queryKey: getGetPassingOrdersQueryKey(raceId, { checkpoint: selectedCp ?? undefined }) } }
  );

  const startCorrectionMut = useStartCorrection();
  const completeCorrectionMut = useCompleteCorrection();
  const updatePassingOrderMut = useUpdatePassingOrder();

  // ── Correction mode: if race is already 補正中, start in editing mode
  const isCorrectionMode = race?.status === "補正中";

  // ── Race metadata
  const straight = race ? getStraight(race) : 300;
  const { pts200, ptsStr } = useMemo(
    () => computeCheckpoints(race?.distance ?? 2000, straight),
    [race?.distance, straight]
  );

  // ── Checkpoints for video time display
  const allCheckpoints = [...pts200, ...ptsStr];
  const baseSec = race ? (race.distance / 1000) * 60 + 27 : 90;

  // ── Handle checkpoint button click
  const handleCpClick = (key: string, meter: number) => {
    setSelectedCp(key);
    setVideoTime(cpVideoTime(meter, race?.distance ?? 2000, baseSec) - VIDEO_OFFSET);
  };

  // ── Determine checkpoint type
  const cpType = useMemo(() => {
    if (!selectedCp) return null;
    if (selectedCp === "5m") return "start";
    if (ptsStr.some((p) => p.key === selectedCp)) return "straight";
    return "200m";
  }, [selectedCp, ptsStr]);

  // ── Number of horses
  const numHorses = (entries?.length ?? 14);

  // ── Merge local edits into passing orders
  const displayOrders = useMemo(() => {
    if (!passingOrders) return [];
    return passingOrders.map((o) => ({
      ...o,
      ...(localEdits[o.id] ?? {}),
    }));
  }, [passingOrders, localEdits]);

  // ── Local edit helper
  const setEdit = (id: string, field: string, value: unknown) => {
    setLocalEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [field]: value },
    }));
  };

  // ── Save edits to backend (on 補正完了)
  const saveAllEdits = useCallback(async () => {
    const entries2 = Object.entries(localEdits);
    for (const [id, changes] of entries2) {
      await updatePassingOrderMut.mutateAsync({ id, data: changes as never });
    }
    setLocalEdits({});
  }, [localEdits, updatePassingOrderMut]);

  // ── 補正開始
  const handleStart = () => {
    startCorrectionMut.mutate({ raceId }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
        fetch(`${API}/races/${raceId}/history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_name: "管理者", action_type: "補正開始", description: "補正作業を開始しました" }),
        });
        toast({ title: "補正を開始しました" });
      },
    });
  };

  // ── 一時保存
  const handleTempSave = async () => {
    await saveAllEdits();
    fetch(`${API}/races/${raceId}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_name: "管理者", action_type: "一時保存", description: "入力データを一時保存しました" }),
    });
    toast({ title: "一時保存しました" });
    setConfirmDialog(null);
  };

  // ── 補正完了
  const handleComplete = async () => {
    await saveAllEdits();
    completeCorrectionMut.mutate({ raceId }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetRaceQueryKey(raceId), updated);
        fetch(`${API}/races/${raceId}/history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_name: "管理者", action_type: "補正完了", description: "補正を完了しレビュー待ちに変更しました" }),
        });
        toast({ title: "補正完了。レビュー待ちに変更されました。" });
        navigate("/");
      },
    });
    setConfirmDialog(null);
  };

  const raceTimeFromVideo = videoTime - VIDEO_OFFSET;

  // ── Furlong splits
  const furlongSplits = (entries?.[0] as any)?.furlong_splits ?? [];

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* ── Header ─────────────────────────────────────── */}
      <div className="border-b border-border bg-card px-4 py-2 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate("/")}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted cursor-pointer flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          {isRaceLoading ? (
            <Skeleton className="h-6 w-64" />
          ) : race ? (
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <span className="text-muted-foreground">競馬場</span>
                <span>{race.venue}</span>
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

        <div className="flex items-center gap-2 flex-shrink-0">
          {isCorrectionMode && (
            <Badge variant="outline" className="text-[10px] border-blue-700 text-blue-400 bg-blue-900/20">補正中</Badge>
          )}

          {/* 修正履歴 */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 cursor-pointer"
            onClick={() => setShowHistory(true)}
          >
            <History className="h-3 w-3" />
            修正履歴
          </Button>

          {/* Action buttons */}
          {!isCorrectionMode ? (
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5 bg-primary hover:bg-primary/90 cursor-pointer"
              onClick={handleStart}
              disabled={startCorrectionMut.isPending || !isAdmin}
            >
              <Play className="h-3 w-3" />
              補正開始
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 cursor-pointer"
                onClick={() => setConfirmDialog("save")}
              >
                <Save className="h-3 w-3" />
                一時保存
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5 bg-green-700 hover:bg-green-600 text-white border-0 cursor-pointer"
                onClick={() => setConfirmDialog("complete")}
                disabled={completeCorrectionMut.isPending}
              >
                <CheckCircle2 className="h-3 w-3" />
                補正完了
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={() => navigate("/")}
              >
                キャンセル
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── 3-column body ───────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── LEFT: JRA公式データ (22%) ─────────────────── */}
        <div className="w-[22%] min-w-[200px] border-r border-border flex flex-col bg-card/40">
          <div className="px-3 py-1.5 border-b border-border bg-card flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] font-semibold text-muted-foreground">JRA公式データ</span>
            <div className="flex items-center gap-0.5">
              {(["furlong", "both", "entries"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setLeftView(v)}
                  className={`px-1.5 py-0.5 text-[10px] rounded cursor-pointer transition-colors ${
                    leftView === v
                      ? "bg-primary text-white"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "furlong" ? "ハロン" : v === "entries" ? "出走馬" : "両方"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Furlong times */}
            {(leftView === "furlong" || leftView === "both") && (
              <div className="p-2 border-b border-border/50">
                <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">ハロンタイム</div>
                {furlongSplits.length > 0 ? (
                  <div className="grid grid-cols-4 gap-0.5">
                    {furlongSplits.map((t: number, i: number) => (
                      <div
                        key={i}
                        className="bg-zinc-800 rounded px-1 py-0.5 text-center text-[10px] font-mono text-zinc-200"
                      >
                        {t.toFixed(1)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground text-center py-2">データなし</div>
                )}
              </div>
            )}

            {/* Entry table */}
            {(leftView === "entries" || leftView === "both") && (
              <div>
                <table className="w-full text-[10px]">
                  <thead className="bg-muted/60 sticky top-0 z-10">
                    <tr>
                      <th className="p-1 text-center text-muted-foreground">馬<br/>番</th>
                      <th className="p-1 text-center text-muted-foreground">枠</th>
                      <th className="p-1 text-left text-muted-foreground">馬名</th>
                      <th className="p-1 text-right text-muted-foreground">着<br/>順</th>
                      <th className="p-1 text-right text-muted-foreground">タイム</th>
                      <th className="p-1 text-right text-muted-foreground">着<br/>差</th>
                      <th className="p-1 text-right text-muted-foreground">3F</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries?.sort((a, b) => a.horse_number - b.horse_number).map((e) => {
                      const gn = e.gate_number ?? 1;
                      const cap = CAP_COLORS[gn] ?? CAP_COLORS[1];
                      const ft = (e as any).finish_time;
                      const min = ft ? Math.floor(ft / 60) : null;
                      const sec = ft ? (ft % 60).toFixed(1) : null;
                      const timeStr = (min !== null && sec !== null) ? `${min}:${sec.padStart(4, "0")}` : "-";
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
                          <td className="p-1 text-right font-mono font-bold">{e.finish_position ?? "-"}</td>
                          <td className="p-1 text-right font-mono text-muted-foreground">{timeStr}</td>
                          <td className="p-1 text-right font-mono text-muted-foreground">{(e as any).margin != null ? (e as any).margin.toFixed(1) : "-"}</td>
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

        {/* ── MIDDLE: Video + section buttons (38%) ────── */}
        <div className="w-[38%] flex flex-col border-r border-border overflow-hidden">
          {/* Video player area */}
          <div className="flex-shrink-0 p-2 bg-zinc-950">
            {/* Video box 3:4 ratio centered */}
            <div className="flex justify-center">
              <div className="relative w-full max-w-[220px]" style={{ aspectRatio: "3/4" }}>
                <div className="absolute inset-0 bg-zinc-900 rounded flex flex-col items-center justify-center border border-zinc-700 overflow-hidden">
                  {/* Ruler overlay */}
                  {rulerEnabled && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ transform: `rotate(${rulerAngle}deg)`, transformOrigin: "center" }}
                    >
                      <div
                        className="absolute w-full border-t-2 border-orange-400/70"
                        style={{ top: `${rulerY}%` }}
                      />
                    </div>
                  )}
                  <Play className="h-10 w-10 text-zinc-600 mb-2" />
                  <span className="text-xs text-zinc-600">レース動画</span>
                  {selectedCp && (
                    <span className="text-[10px] text-zinc-500 mt-1">
                      {selectedCp === "5m" ? "5m地点(スタート)" : selectedCp}
                    </span>
                  )}
                </div>

                {/* Race time overlay top-right */}
                <div className="absolute top-1 right-1 bg-black/70 rounded px-1 py-0.5">
                  <div className="text-[9px] text-zinc-400">動画: {fmtVideoTime(videoTime)}</div>
                  <div className="text-[9px] text-red-400 font-mono">
                    レース: {raceTimeFromVideo < 0 ? `-${fmtTime(Math.abs(raceTimeFromVideo))}` : fmtTime(raceTimeFromVideo)}
                  </div>
                </div>
              </div>
            </div>

            {/* Video controls */}
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-1.5 justify-between flex-wrap">
                <div className="flex items-center gap-1">
                  <button onClick={() => setVideoTime(0)} className="text-zinc-400 hover:text-white cursor-pointer p-0.5"><ChevronFirst className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setVideoTime((t) => Math.max(0, t - 1 / 30))} className="text-zinc-400 hover:text-white cursor-pointer p-0.5"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="bg-primary/20 hover:bg-primary/40 text-primary border border-primary/40 rounded p-1 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => setVideoTime((t) => Math.min(120, t + 1 / 30))} className="text-zinc-400 hover:text-white cursor-pointer p-0.5"><ChevronRight className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setVideoTime(120)} className="text-zinc-400 hover:text-white cursor-pointer p-0.5"><ChevronLast className="h-3.5 w-3.5" /></button>
                </div>

                <div className="flex items-center gap-1">
                  {PLAY_SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setPlaySpeed(s)}
                      className={`text-[10px] px-1.5 py-0.5 rounded border cursor-pointer ${
                        playSpeed === s
                          ? "bg-primary/20 border-primary text-primary"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                      }`}
                    >
                      ×{s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-zinc-500 font-mono w-8 text-right">{fmtVideoTime(videoTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={120}
                  step={0.033}
                  value={videoTime}
                  onChange={(e) => setVideoTime(parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-orange-500 cursor-pointer"
                />
                <span className="text-[9px] text-zinc-500 font-mono w-8">2:00</span>
              </div>

              {/* Ruler toggle */}
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rulerEnabled}
                    onChange={(e) => setRulerEnabled(e.target.checked)}
                    className="cursor-pointer accent-orange-500"
                  />
                  <Ruler className="h-3 w-3 text-zinc-400" />
                  <span className="text-[10px] text-zinc-400">罫線</span>
                </label>
                {rulerEnabled && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-zinc-500">位置</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={rulerY}
                        onChange={(e) => setRulerY(parseInt(e.target.value))}
                        className="w-20 h-1 accent-orange-500 cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-zinc-500">角度</span>
                      <input
                        type="range"
                        min={-45}
                        max={45}
                        value={rulerAngle}
                        onChange={(e) => setRulerAngle(parseInt(e.target.value))}
                        className="w-20 h-1 accent-orange-500 cursor-pointer"
                      />
                      <span className="text-[9px] text-zinc-500 w-7">{rulerAngle}°</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Section buttons */}
          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            {race && (
              <>
                {/* 200m毎の地点 */}
                <div>
                  <div className="text-[10px] text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
                    <span>200m毎の地点</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pts200.map((pt) => {
                      const vt = cpVideoTime(pt.meter, race.distance, baseSec);
                      const isSelected = selectedCp === pt.key;
                      return (
                        <button
                          key={pt.key}
                          onClick={() => handleCpClick(pt.key, pt.meter)}
                          className={`flex flex-col items-center px-2 py-1 rounded border text-[10px] cursor-pointer transition-colors min-w-[48px] ${
                            isSelected
                              ? "bg-primary border-primary text-white"
                              : "bg-card border-border text-foreground hover:border-primary/50 hover:bg-muted/40"
                          }`}
                        >
                          <span className="font-medium leading-tight whitespace-pre-line text-center text-[9px]">
                            {pt.label}
                          </span>
                          <span className={`mt-0.5 font-mono text-[9px] ${isSelected ? "text-white/70" : "text-muted-foreground"}`}>
                            {fmtVideoTime(vt)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 最後の直線 */}
                <div>
                  <div className="text-[10px] text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
                    <span>最後の直線</span>
                    <span className="text-[9px] text-zinc-600">{straight}m</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ptsStr.map((pt) => {
                      const vt = cpVideoTime(pt.meter, race.distance, baseSec);
                      const isSelected = selectedCp === pt.key;
                      return (
                        <button
                          key={pt.key}
                          onClick={() => handleCpClick(pt.key, pt.meter)}
                          className={`flex flex-col items-center px-2 py-1 rounded border text-[10px] cursor-pointer transition-colors min-w-[48px] ${
                            isSelected
                              ? "bg-orange-600 border-orange-500 text-white"
                              : "bg-card border-border text-foreground hover:border-orange-500/50 hover:bg-muted/40"
                          }`}
                        >
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

        {/* ── RIGHT: Analysis results (40%) ─────────────── */}
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
                  isCorrectionMode={isCorrectionMode}
                  onEdit={setEdit}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────── */}
      {showHistory && <HistoryModal raceId={raceId} onClose={() => setShowHistory(false)} />}

      {confirmDialog === "save" && (
        <ConfirmDialog
          title="一時保存の確認"
          message="現在の入力情報を一時保存しますか？"
          confirmLabel="一時保存"
          onConfirm={handleTempSave}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {confirmDialog === "complete" && (
        <ConfirmDialog
          title="補正完了の確認"
          message="補正を完了しますか？ステータスがレビュー待ちに変わり、レース一覧へ戻ります。"
          confirmLabel="補正完了"
          onConfirm={handleComplete}
          onCancel={() => setConfirmDialog(null)}
          loading={completeCorrectionMut.isPending}
        />
      )}
    </div>
  );
}

// ── Right Table ──────────────────────────────────────────────────────────────
function RightTable({
  cpType,
  orders,
  entries,
  numHorses,
  isCorrectionMode,
  onEdit,
}: {
  cpType: "start" | "200m" | "straight";
  orders: any[];
  entries: any[];
  numHorses: number;
  isCorrectionMode: boolean;
  onEdit: (id: string, field: string, value: unknown) => void;
}) {
  // Horse numbers from entries for dropdown
  const horseNumbers = Array.from({ length: numHorses }, (_, i) => i + 1);

  // Set of horse_numbers that appear in orders
  const presentNums = new Set(orders.map((o) => o.horse_number));
  // Missing horses: in entries but not in orders
  const missingHorses = entries
    .map((e) => e.horse_number)
    .filter((n) => !presentNums.has(n));

  // Phantom rows for missing horses
  const phantomRows = missingHorses.map((hn) => {
    const e = entries.find((x) => x.horse_number === hn);
    return {
      id: `phantom-${hn}`,
      position: null,
      horse_number: hn,
      gate_number: e?.gate_number ?? null,
      color: null,
      lane: null,
      time_seconds: null,
      accuracy: null,
      special_note: null,
      running_position: null,
      absolute_speed: null,
      speed_change: null,
      is_phantom: true,
    };
  });

  const allRows = [...orders, ...phantomRows];

  return (
    <table className="w-full text-xs">
      <thead className="bg-muted/60 sticky top-0 z-10">
        <tr>
          <th className="p-1.5 text-center text-muted-foreground text-[10px]">順位</th>
          <th className="p-1.5 text-center text-muted-foreground text-[10px]">馬番</th>
          <th className="p-1.5 text-center text-muted-foreground text-[10px]">枠</th>
          <th className="p-1.5 text-center text-muted-foreground text-[10px]">帽色</th>
          <th className="p-1.5 text-right text-muted-foreground text-[10px]">通過タイム</th>
          {cpType === "200m" && <th className="p-1.5 text-center text-muted-foreground text-[10px]">レーン</th>}
          {cpType === "straight" && (
            <>
              <th className="p-1.5 text-right text-muted-foreground text-[10px]">速度</th>
              <th className="p-1.5 text-right text-muted-foreground text-[10px]">変化</th>
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

          return (
            <tr
              key={row.id ?? idx}
              className={`border-t border-border/30 ${isPhantom ? "opacity-50" : "hover:bg-muted/20"}`}
            >
              {/* 順位 */}
              <td className="p-1.5 text-center font-mono font-bold text-sm">
                {row.position != null ? row.position : <span className="text-zinc-600">-</span>}
              </td>

              {/* 馬番 */}
              <td className="p-1.5 text-center">
                {isCorrectionMode && !isPhantom ? (
                  <select
                    value={hn ?? ""}
                    onChange={(e) => onEdit(row.id, "horse_number", parseInt(e.target.value))}
                    className="bg-zinc-800 border border-zinc-600 rounded text-[10px] px-1 py-0.5 cursor-pointer text-foreground w-10"
                  >
                    {Array.from({ length: numHorses }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{i + 1}</option>
                    ))}
                  </select>
                ) : (
                  <span className="font-mono font-bold">{hn ?? "-"}</span>
                )}
              </td>

              {/* 枠 */}
              <td className="p-1.5 text-center">
                {gn != null ? (
                  <span
                    className="inline-flex w-5 h-5 rounded-sm items-center justify-center text-[10px] font-bold border border-white/20"
                    style={{ backgroundColor: cap?.bg ?? "#333", color: cap?.text ?? "#fff" }}
                  >{gn}</span>
                ) : <span className="text-zinc-600">-</span>}
              </td>

              {/* 帽色 */}
              <td className="p-1.5 text-center">
                <CapCircle gate={gn} />
              </td>

              {/* 通過タイム */}
              <td className="p-1.5 text-right font-mono text-[10px]">
                {row.time_seconds != null ? `${row.time_seconds.toFixed(2)}s` : <span className="text-zinc-600">-</span>}
              </td>

              {/* レーン (200m only) */}
              {cpType === "200m" && (
                <td className="p-1.5 text-center">
                  {isCorrectionMode && !isPhantom ? (
                    <select
                      value={row.lane ?? "中"}
                      onChange={(e) => onEdit(row.id, "lane", e.target.value)}
                      className="bg-zinc-800 border border-zinc-600 rounded text-[10px] px-1 py-0.5 cursor-pointer text-foreground"
                    >
                      {LANES.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  ) : (
                    <span className="text-muted-foreground">{row.lane ?? "-"}</span>
                  )}
                </td>
              )}

              {/* Straight-only columns */}
              {cpType === "straight" && (
                <>
                  <td className="p-1.5 text-right font-mono text-[10px] text-cyan-400">
                    {row.absolute_speed != null ? `${row.absolute_speed.toFixed(1)}` : <span className="text-zinc-600">-</span>}
                  </td>
                  <td className="p-1.5 text-right font-mono text-[10px]">
                    {row.speed_change != null ? (
                      <span className={row.speed_change >= 0 ? "text-green-400" : "text-red-400"}>
                        {row.speed_change >= 0 ? "+" : ""}{row.speed_change.toFixed(1)}
                      </span>
                    ) : <span className="text-zinc-600">-</span>}
                  </td>
                  <td className="p-1.5 text-center">
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
                    ) : (
                      <span className="text-muted-foreground text-[10px]">
                        {row.running_position != null ? `${row.running_position}頭目` : "-"}
                      </span>
                    )}
                  </td>
                </>
              )}

              {/* 特記事項 */}
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
                  <span className={`text-[10px] ${row.special_note ? "text-amber-400 font-medium" : "text-zinc-600"}`}>
                    {row.special_note || "ー"}
                  </span>
                )}
              </td>

              {/* 信頼度 */}
              <td className="p-1.5 text-center">
                <AccBadge v={isPhantom ? null : row.accuracy} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
