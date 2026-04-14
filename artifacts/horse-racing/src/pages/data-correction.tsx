import {
  useState, useMemo, useEffect, useRef, useCallback,
} from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Play, Pause, ChevronFirst, ChevronLast,
  History, CheckCircle2, Save, Clock,
  ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, X,
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
  1: { bg: "#ffffff", text: "#000", label: "class_white_1" },
  2: { bg: "#111111", text: "#fff", label: "class_black_1" },
  3: { bg: "#dc2626", text: "#fff", label: "class_red_1" },
  4: { bg: "#2563eb", text: "#fff", label: "class_blue_1" },
  5: { bg: "#facc15", text: "#000", label: "class_yellow_1" },
  6: { bg: "#16a34a", text: "#fff", label: "class_green_1" },
  7: { bg: "#ea580c", text: "#000", label: "class_orange_1" },
  8: { bg: "#ec4899", text: "#000", label: "class_pink_1" },
};

const SPECIAL_NOTES = ["出遅れ", "大幅遅れ", "映像見切れ", "確認困難（ブレが大きい）", "その他"];
const PLAY_SPEEDS = [0.5, 1.0, 1.5, 2.0];

const VENUE_ID_MAP: Record<string, string> = {
  "中山": "nakayama", "阪神": "hanshin", "京都": "kyoto", "東京": "tokyo",
  "大井": "oi", "川崎": "kawasaki",
};

function formatGoalTime(sec: number): string {
  const total = Math.round(sec * 100);
  const mm = Math.floor(total / 6000);
  const ss = Math.floor((total % 6000) / 100);
  const cc = total % 100;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}:${String(cc).padStart(2, "0")}`;
}

function parseGoalTime(s: string): number | null {
  const m = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / 100;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

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


function AccBadge({ v }: { v?: number | null }) {
  if (v == null) return <span className="text-zinc-600">-</span>;
  const color = v >= 90 ? "text-green-400" : v >= 75 ? "text-yellow-400" : "text-red-400";
  return <span className={`font-mono text-xs ${color}`}>{v}%</span>;
}

function CapCircle({ gate, label }: { gate?: number | null; label?: string }) {
  const c = gate != null ? CAP_COLORS[gate] : null;
  if (!c) return <span className="text-zinc-500 text-xs">-</span>;
  const displayLabel = label ?? c.label;
  return (
    <span className="text-[9px] font-mono text-zinc-300" title={displayLabel}>
      {displayLabel}
    </span>
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
const GOAL_TIME_STEPS = [1, 0.1, 0.01];

function AnalysisOptionDialog({
  raceId, raceName, venue, onCancel, onSaved, isAdmin, raceStatus, onReanalyze, onReanalysisRequest,
}: {
  raceId: string; raceName: string; venue?: string; onCancel: () => void;
  onSaved: () => void; isAdmin: boolean; raceStatus: string;
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

  const venueCode = venue ? VENUE_ID_MAP[venue] : undefined;
  const filteredPresets = venueCode
    ? presets.filter((p) => p.venue_code === venueCode)
    : presets;

  useEffect(() => {
    Promise.all([
      fetch(`${API}/races/${raceId}/analysis-option`).then((r) => r.json()),
      fetch(`${API}/venue-weather-presets`).then((r) => r.json()),
    ]).then(([existing, presetList]) => {
      setPresets(presetList || []);
      if (existing) {
        if (existing.video_goal_time != null) setGoalTime(formatGoalTime(Number(existing.video_goal_time)));
        if (existing.venue_weather_preset_id) setPresetId(existing.venue_weather_preset_id);
        if (existing.comment) setComment(existing.comment);
      }
      setFetching(false);
    }).catch(() => setFetching(false));
  }, [raceId]);

  const adjustGoalTime = (delta: number) => {
    const current = parseGoalTime(goalTime) ?? 0;
    const next = Math.max(0, Math.round((current + delta) * 100) / 100);
    setGoalTime(formatGoalTime(next));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      const gtSec = parseGoalTime(goalTime);
      if (gtSec != null && gtSec > 0) body.video_goal_time = gtSec;
      if (presetId) body.venue_weather_preset_id = presetId;
      body.comment = comment.trim() || null;
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

  const handleReanalysisRequest = () => {
    const isOther = reanalysisReason === "その他";
    if (isOther && !comment.trim()) return;
    onReanalysisRequest(reanalysisReason, comment);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[500px] max-w-[95vw] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">解析オプション</h2>
          <button onClick={onCancel} className="text-zinc-400 hover:text-white cursor-pointer text-lg leading-none">✕</button>
        </div>
        {fetching ? (
          <div className="text-xs text-muted-foreground py-4 text-center">読み込み中...</div>
        ) : (
          <>
            {/* Goal time with step buttons */}
            <div className="mb-3">
              <div className="text-xs font-medium text-muted-foreground mb-1.5">ゴールタイム（1/100秒まで）</div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {GOAL_TIME_STEPS.map((s) => (
                    <button key={`m${s}`} onClick={() => adjustGoalTime(-s)} className="px-1.5 py-1 text-[11px] bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded cursor-pointer font-mono">−{s}</button>
                  ))}
                </div>
                <input
                  type="text"
                  value={goalTime}
                  onChange={(e) => setGoalTime(e.target.value)}
                  placeholder="01:30:00"
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded text-sm p-2 text-foreground font-mono text-center min-w-0"
                />
                <div className="flex gap-1">
                  {[...GOAL_TIME_STEPS].reverse().map((s) => (
                    <button key={`p${s}`} onClick={() => adjustGoalTime(s)} className="px-1.5 py-1 text-[11px] bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded cursor-pointer font-mono">+{s}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Venue-filtered presets */}
            <div className="mb-3">
              <div className="text-xs font-medium text-muted-foreground mb-1.5">
                解析プリセット
                {venue && <span className="ml-1 text-zinc-500">（{venue}）</span>}
              </div>
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded text-sm p-2 text-foreground cursor-pointer"
              >
                <option value="">選択してください</option>
                {filteredPresets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <div className="text-xs font-medium text-muted-foreground mb-1.5">
                コメント{showReanalysisForm && reanalysisReason === "その他" ? <span className="text-red-400 ml-1">（必須）</span> : "（任意）"}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded text-sm p-2 text-foreground resize-none h-20"
                placeholder="メモを入力してください"
              />
            </div>

            {showReanalysisForm && (
              <div className="mb-4 border border-red-900/50 rounded p-3 bg-red-950/20">
                <div className="text-xs font-medium text-red-400 mb-2">再解析理由</div>
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
            {isAdmin && raceStatus !== "未処理" && (
              <Button size="sm" onClick={onReanalyze} disabled={saving || fetching}
                className="h-8 text-xs cursor-pointer gap-1.5 bg-red-800 hover:bg-red-700 text-white border-0">
                <RefreshCw className="h-3 w-3" />再解析
              </Button>
            )}
            {!isAdmin && raceStatus !== "未処理" && (
              showReanalysisForm ? (
                <Button size="sm" onClick={handleReanalysisRequest}
                  disabled={saving || fetching || (reanalysisReason === "その他" && !comment.trim())}
                  className="h-8 text-xs cursor-pointer gap-1.5 bg-red-700 hover:bg-red-600 text-white border-0">
                  <AlertTriangle className="h-3 w-3" />再解析要請を送信
                </Button>
              ) : (
                <Button size="sm" onClick={() => setShowReanalysisForm(true)} disabled={saving || fetching}
                  className="h-8 text-xs cursor-pointer gap-1.5 bg-red-900/80 hover:bg-red-800 text-red-300 border border-red-800">
                  <AlertTriangle className="h-3 w-3" />再解析要請
                </Button>
              )
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
  const [selectedCp, setSelectedCp] = useState<string | null>(null);

  // Edit mode: purely local; resets when leaving the page
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [savingTemp, setSavingTemp] = useState(false);

  // Editable start/goal times (video offset + race duration in seconds)
  const [customVideoOffset, setCustomVideoOffset] = useState<number | null>(null);
  const [customRaceDuration, setCustomRaceDuration] = useState<number | null>(null);
  const [startTimeInput, setStartTimeInput] = useState<string>("");
  const [goalTimeInput, setGoalTimeInput] = useState<string>("");

  // Video state
  const [videoTime, setVideoTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1.0);

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


  const numHorses = entries?.length ?? 14;

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
    const vt = cpVideoTime(meter, race?.distance ?? 2000, effectiveBaseSec, effectiveVideoOffset) - effectiveVideoOffset;
    setVideoTime(Math.max(0, vt));
  };

  const raceTimeFromVideo = videoTime - effectiveVideoOffset;
  const canStartCorrection = raceStatus === "待機中" || raceStatus === "修正要請" || raceStatus === "レビュー待ち" || (raceStatus === "データ確定" && isAdmin);

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
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => { if (window.history.length > 1) { window.history.back(); } else { navigate("/"); } }}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted cursor-pointer flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          {/* Status badge beside back button */}
          {isRaceLoading ? <Skeleton className="h-5 w-20" /> : (
            <>
              {raceStatus && (
                <Badge
                  variant="outline"
                  className={`text-[10px] cursor-pointer ${
                    raceStatus === "補正中" ? "border-cyan-700 text-cyan-400 bg-cyan-900/20"
                    : raceStatus === "待機中" ? "border-cyan-700 text-cyan-300 bg-cyan-900/10"
                    : raceStatus === "レビュー待ち" ? "border-purple-700 text-purple-400 bg-purple-900/20"
                    : raceStatus === "修正要請" ? "border-orange-700 text-orange-400 bg-orange-900/20"
                    : raceStatus === "データ確定" ? "border-green-700 text-green-400 bg-green-900/20"
                    : raceStatus === "再解析要請" ? "border-red-700 text-red-400 bg-red-900/20"
                    : raceStatus === "突合失敗" ? "border-red-700 text-red-400 bg-red-900/20"
                    : raceStatus === "解析中" ? "border-cyan-700 text-cyan-400 bg-cyan-900/20"
                    : raceStatus === "解析失敗" ? "border-red-700 text-red-400 bg-red-900/20"
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
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">

          {/* 補正中インジケーター */}
          {raceStatus === "補正中" && raceLockedBy && (
            <span className="text-xs text-cyan-400 px-2 py-1 bg-cyan-900/20 border border-cyan-800/50 rounded">
              {raceLockedBy}が補正中
            </span>
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
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5 text-white border-0 cursor-pointer bg-green-700 hover:bg-green-600"
                onClick={() => {
                  if (hasDuplicateHorseNumbers) {
                    toast({ title: "馬番の重複があります", description: "同一地点に同じ馬番が存在します。解消してから完了してください。", variant: "destructive" });
                    return;
                  }
                  setConfirmDialog("complete");
                }}
                disabled={completeCorrectionMut.isPending}
              >
                <CheckCircle2 className="h-3 w-3" />補正完了
              </Button>
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

        {/* MIDDLE: Video + section buttons */}
        <div className="flex-1 flex flex-col border-r border-border overflow-hidden">

          {/* Video area */}
          <div className="flex-shrink-0 bg-zinc-950">

            {/* Video box — full column width, 16:9 */}
            <div className="relative w-full overflow-hidden" style={{ aspectRatio: "16/9" }}>
              {/* Video background */}
              <div className="absolute inset-0 bg-zinc-900 overflow-hidden">
                {/* Simulated video background */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Play className="h-12 w-12 text-zinc-700 mb-2" />
                  <span className="text-xs text-zinc-600">レース動画</span>
                </div>

                {/* Selected checkpoint indicator */}
                {selectedCp && (
                  <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
                    <span className="bg-black/60 text-zinc-400 text-[10px] px-2 py-0.5 rounded">
                      {selectedCp === "5m" ? "5m地点(スタート)" : selectedCp}
                    </span>
                  </div>
                )}
              </div>

              {/* Time overlay */}
              <div className="absolute top-1.5 right-1.5 bg-black/75 rounded px-1.5 py-0.5 pointer-events-none z-20">
                <div className="text-[9px] text-zinc-400">動画: {fmtVideoTime(videoTime)}</div>
                <div className="text-[9px] text-red-400 font-mono">
                  レース: {raceTimeFromVideo < 0
                    ? `-${fmtTime(Math.abs(raceTimeFromVideo))}`
                    : fmtTime(raceTimeFromVideo)}
                </div>
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
          venue={race?.venue}
          isAdmin={isAdmin}
          raceStatus={raceStatus}
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
  orders, entries, numHorses, isCorrectionMode, onEdit, duplicateHorseNumbers,
}: {
  orders: any[];
  entries: any[];
  numHorses: number;
  isCorrectionMode: boolean;
  onEdit: (id: string, field: string, value: unknown) => void;
  duplicateHorseNumbers?: Set<number>;
}) {
  const presentNums = new Set(orders.map((o) => o.horse_number));
  const missingHorses = entries.map((e) => e.horse_number).filter((n) => !presentNums.has(n));
  const [timeWarnShown, setTimeWarnShown] = useState(false);

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

  // Dynamic cap label: e.g. class_white_1, class_white_2 when same gate appears multiple times
  const dynamicCapLabels = useMemo(() => {
    const gateCounters: Record<number, number> = {};
    const result: Record<string, string> = {};
    for (const row of allRows) {
      const gn = row.gate_number;
      if (gn != null && CAP_COLORS[gn]) {
        gateCounters[gn] = (gateCounters[gn] ?? 0) + 1;
        const baseName = CAP_COLORS[gn].label.replace(/_\d+$/, "");
        result[row.id] = `${baseName}_${gateCounters[gn]}`;
      }
    }
    return result;
  }, [allRows]);

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

          const rowBg = isPhantom
            ? "opacity-50"
            : isDuplicate
              ? "bg-red-900/20 hover:bg-red-900/30"
              : "hover:bg-muted/20";

          const rowLeftBorder = isPhantom
            ? ""
            : isDuplicate
              ? "border-l-2 border-l-red-500"
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
                  <CapCircle gate={gn} label={dynamicCapLabels[row.id]} />
                )}
              </td>

              <td className="p-1.5 text-left text-[10px] text-zinc-200 max-w-[80px] truncate" title={horseName ?? ""}>
                {horseName ?? <span className="text-zinc-600">-</span>}
              </td>

              <td className="p-1.5 text-right font-mono text-[10px]">
                {isCorrectionMode && !isPhantom ? (
                  <input
                    type="text"
                    defaultValue={row.time_seconds != null ? row.time_seconds.toFixed(2) : ""}
                    onFocus={(e) => {
                      if (!timeWarnShown) {
                        const ok = window.confirm("変更すると推定ロジックが崩れる危険性があります。続けますか？");
                        if (ok) {
                          setTimeWarnShown(true);
                        } else {
                          e.currentTarget.blur();
                        }
                      }
                    }}
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) onEdit(row.id, "time_seconds", v);
                      else if (e.target.value === "") onEdit(row.id, "time_seconds", null);
                    }}
                    placeholder="欠損"
                    className="w-16 bg-zinc-800 border border-zinc-600 rounded text-[10px] px-1 py-0.5 text-right font-mono text-foreground"
                  />
                ) : row.time_seconds != null ? (
                  <span>{row.time_seconds.toFixed(2)}s</span>
                ) : !isPhantom ? (
                  <span className="text-red-400 font-bold">欠損</span>
                ) : <span className="text-zinc-600">-</span>}
              </td>

              <td className="p-1.5 text-center">
                {isCorrectionMode && !isPhantom ? (
                  <select
                    value={row.special_note ?? ""}
                    onChange={(e) => onEdit(row.id, "special_note", e.target.value === "" ? null : e.target.value)}
                    className="bg-zinc-800 border border-zinc-600 rounded text-[10px] px-1 py-0.5 cursor-pointer text-foreground max-w-[100px]"
                  >
                    <option value="">ー</option>
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
