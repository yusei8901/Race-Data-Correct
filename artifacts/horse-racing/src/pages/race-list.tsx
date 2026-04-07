import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Calendar, RefreshCcw, AlertTriangle, X, RotateCcw, Download, RefreshCw } from "lucide-react";
import {
  useGetRaces,
  getGetRacesQueryKey,
  useGetRaceSummary,
  getGetRaceSummaryQueryKey,
  useBatchUpdateRaces,
  useReanalyzeRace,
} from "@workspace/api-client-react";
import type { Race } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useQueryClient } from "@tanstack/react-query";
import { useUserRole } from "@/contexts/user-role";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = BASE_URL + "/fastapi";

// ---- Status Matrix ----
type DerivedStatus =
  | "未処理"
  | "未解析"
  | "解析中"
  | "待機中"
  | "補正中"
  | "再補正中"
  | "レビュー待ち"
  | "データ確定"
  | "修正要請"
  | "解析失敗"
  | "再解析要請"
  | "突合失敗";

const KNOWN_STATUSES: ReadonlySet<DerivedStatus> = new Set<DerivedStatus>([
  "未処理", "未解析", "解析中", "待機中", "補正中", "再補正中",
  "レビュー待ち", "データ確定", "修正要請", "解析失敗", "再解析要請", "突合失敗",
]);

function getDerivedStatus(race: Race): DerivedStatus {
  // Prefer the API's pre-computed display_status (backend handles all logic)
  const ds = race.display_status ?? "";
  if (ds && KNOWN_STATUSES.has(ds as DerivedStatus)) {
    return ds as DerivedStatus;
  }
  // Fallback: compute from component fields for backward compatibility
  const vs = race.video_status ?? "";
  const as_ = race.analysis_status ?? "";
  const st = race.status ?? "";

  if (vs !== "完了") return "未処理";
  if (as_ === "未" || as_ === "") return "未解析";
  if (as_ === "解析中" || as_ === "再解析中") return "解析中";
  if (as_ === "解析失敗") {
    if (st === "再解析要請" || st === "REANALYZING") return "再解析要請";
    return "解析失敗";
  }
  if (as_ === "突合失敗") return "突合失敗";
  if (as_ === "完了") {
    if (st === "ANALYZED" || st === "待機中" || st === "未補正") return "待機中";
    if (st === "CORRECTING" || st === "補正中") return "補正中";
    if (st === "CORRECTED" || st === "レビュー待ち") return "レビュー待ち";
    if (st === "CONFIRMED" || st === "データ確定") return "データ確定";
    if (st === "REVISION_REQUESTED" || st === "修正要請" || st === "修正要求") return "修正要請";
    if (st === "補正完了" || st === "データ補正") return "待機中";
    if (st === "レビュー") return "レビュー待ち";
    return "待機中";
  }
  return "未処理";
}

function getStatusBadgeProps(status: DerivedStatus) {
  switch (status) {
    case "未処理":       return { className: "bg-zinc-800/60 text-zinc-400 border-zinc-700", label: "未処理" };
    case "未解析":       return { className: "bg-slate-800/60 text-slate-400 border-slate-700", label: "未解析" };
    case "解析中":       return { className: "bg-cyan-900/40 text-cyan-400 border-cyan-800", label: "解析中" };
    case "待機中":       return { className: "bg-yellow-900/40 text-yellow-400 border-yellow-800", label: "待機中" };
    case "補正中":       return { className: "bg-blue-900/40 text-blue-400 border-blue-800", label: "補正中" };
    case "再補正中":     return { className: "bg-indigo-900/40 text-indigo-400 border-indigo-800", label: "再補正中" };
    case "レビュー待ち": return { className: "bg-purple-900/40 text-purple-400 border-purple-800", label: "レビュー待ち" };
    case "データ確定":   return { className: "bg-green-900/40 text-green-400 border-green-800", label: "データ確定" };
    case "修正要請":     return { className: "bg-orange-900/40 text-orange-400 border-orange-800", label: "修正要請" };
    case "解析失敗":     return { className: "bg-red-900/50 text-red-400 border-red-800", label: "解析失敗" };
    case "再解析要請":   return { className: "bg-rose-900/40 text-rose-400 border-rose-800", label: "再解析要請" };
    case "突合失敗":     return { className: "bg-red-950/60 text-red-300 border-red-900", label: "突合失敗" };
    default:             return { className: "bg-muted text-muted-foreground border-muted-border", label: status };
  }
}

const CORRECTION_DISABLED_STATUSES: DerivedStatus[] = [
  "未処理", "未解析", "解析中", "解析失敗",
];

const SELECTABLE_STATUSES: DerivedStatus[] = ["待機中", "補正中", "レビュー待ち", "修正要請", "データ確定"];
const BULK_STATUS_OPTIONS: DerivedStatus[] = ["待機中", "補正中", "レビュー待ち", "修正要請", "データ確定"];

function isSelectable(status: DerivedStatus): boolean {
  return SELECTABLE_STATUSES.includes(status);
}

const RACE_TYPES = [
  { value: "中央競馬", label: "中央競馬" },
  { value: "地方競馬", label: "地方競馬" },
  { value: "海外競馬", label: "海外競馬" },
];

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateTitle(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const wd = WEEKDAYS[d.getDay()];
    return `${y}年${m}月${day}日（${wd}）のレース一覧`;
  } catch {
    return "レース一覧";
  }
}

const ALERT_STATUSES: Set<DerivedStatus> = new Set(["修正要請", "解析失敗", "再解析要請", "突合失敗"]);
const HIGHLIGHT_STATUSES: Set<DerivedStatus> = new Set([...ALERT_STATUSES, "未処理"]);

const ALERT_STYLE_MAP: Record<string, { bg: string; border: string; hoverBorder: string; hoverBg: string; shadow: string; textColor: string }> = {
  "修正要請":   { bg: "bg-orange-950/80", border: "border-orange-500", hoverBorder: "hover:border-orange-300", hoverBg: "hover:bg-orange-900/60", shadow: "shadow-[0_0_10px_rgba(249,115,22,0.45)]", textColor: "text-orange-200" },
  "解析失敗":   { bg: "bg-red-950/80",    border: "border-red-500",    hoverBorder: "hover:border-red-300",    hoverBg: "hover:bg-red-900/60",    shadow: "shadow-[0_0_10px_rgba(239,68,68,0.45)]",  textColor: "text-red-200" },
  "再解析要請": { bg: "bg-rose-950/80",   border: "border-rose-500",   hoverBorder: "hover:border-rose-300",   hoverBg: "hover:bg-rose-900/60",   shadow: "shadow-[0_0_10px_rgba(244,63,94,0.45)]",  textColor: "text-rose-200" },
  "突合失敗":   { bg: "bg-red-950/80",    border: "border-red-600",    hoverBorder: "hover:border-red-400",    hoverBg: "hover:bg-red-900/60",    shadow: "shadow-[0_0_10px_rgba(239,68,68,0.45)]",  textColor: "text-red-200" },
};

const STATUS_ROW1: { key: DerivedStatus; label: string; colorClass: string }[] = [
  { key: "データ確定",   label: "データ確定",   colorClass: "text-green-400" },
  { key: "修正要請",     label: "修正要請",     colorClass: "text-orange-400" },
  { key: "補正中",       label: "補正中",       colorClass: "text-blue-400" },
  { key: "解析中",       label: "解析中",       colorClass: "text-cyan-400" },
  { key: "解析失敗",     label: "解析失敗",     colorClass: "text-red-400" },
];

const STATUS_ROW2: { key: DerivedStatus; label: string; colorClass: string }[] = [
  { key: "レビュー待ち", label: "レビュー待ち", colorClass: "text-purple-400" },
  { key: "再解析要請",   label: "再解析要請",   colorClass: "text-rose-400" },
  { key: "待機中",       label: "待機中",       colorClass: "text-yellow-400" },
  { key: "未処理",       label: "未処理",       colorClass: "text-zinc-400" },
  { key: "突合失敗",     label: "突合失敗",     colorClass: "text-red-300" },
];

const ALL_STATUS_CARDS = [...STATUS_ROW1, ...STATUS_ROW2];

interface ReanalyzeDialogProps {
  race: Race;
  onClose: () => void;
  onExecute: (preset: string) => void;
  isLoading: boolean;
}

const ANALYSIS_PRESETS = ["標準", "逆光用", "曇り用", "雨天用"];

function ReanalyzeDialog({ race, onClose, onExecute, isLoading }: ReanalyzeDialogProps) {
  const [selectedPreset, setSelectedPreset] = useState("標準");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[480px] max-w-[95vw] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">再解析の確認</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4">
          <div className="text-sm text-muted-foreground mb-1">対象レース</div>
          <div className="text-sm font-medium text-foreground">
            {race.venue} {race.race_number}R — {race.race_name}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {race.surface_type} {race.distance}m
          </div>
        </div>

        <div className="flex items-start gap-2 bg-amber-950/40 border border-amber-800/50 rounded-md p-3 mb-5">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-300 leading-relaxed">
            再解析を実行すると、現在の解析結果が上書きされます。この操作は取り消せません。
          </p>
        </div>

        <div className="mb-5">
          <div className="text-xs font-medium text-muted-foreground mb-2">解析パラメータプリセット</div>
          <div className="grid grid-cols-2 gap-2">
            {ANALYSIS_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => setSelectedPreset(preset)}
                className={`py-2 px-3 rounded-md text-sm font-medium border transition-colors cursor-pointer ${
                  selectedPreset === preset
                    ? "bg-orange-500/20 border-orange-500 text-orange-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} disabled={isLoading} className="h-8 text-xs cursor-pointer">
            キャンセル
          </Button>
          <Button
            onClick={() => onExecute(selectedPreset)}
            disabled={isLoading}
            className="h-8 text-xs bg-orange-600 hover:bg-orange-500 text-white border-0 cursor-pointer"
          >
            {isLoading ? "実行中..." : "再解析を実行"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function downloadCSV(races: Race[], venue: string) {
  const filtered = venue !== "all" ? races.filter((r) => r.venue === venue) : races;
  const header = ["競馬場", "R", "出走時刻", "レース名", "芝ダ", "距離", "動画", "ステータス", "担当者", "更新時間"].join(",");
  const rows = filtered.map((r) => {
    const st = getDerivedStatus(r);
    const updatedTime = r.updated_at
      ? (() => { try { const d = new Date(r.updated_at); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; } catch { return "-"; } })()
      : "-";
    return [
      r.venue,
      `${r.race_number}R`,
      r.start_time?.substring(0,5) || "-",
      `"${r.race_name}"`,
      r.surface_type,
      `${r.distance}m`,
      r.video_status === "完了" ? "完了" : "未完了",
      st,
      r.assigned_user || "-",
      updatedTime,
    ].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `races_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const RACE_LIST_STATE_KEY = "raceListState";

function getSavedState() {
  try {
    const raw = sessionStorage.getItem(RACE_LIST_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { date?: string; venue?: string; raceType?: string; statusFilter?: DerivedStatus | "total" | null };
  } catch { return null; }
}

export default function RaceList() {
  const { isAdmin } = useUserRole();
  const { toast } = useToast();

  const saved = getSavedState();
  const [date, setDate] = useState(saved?.date ?? "");
  const [venue, setVenue] = useState<string>(saved?.venue ?? "all");
  const [raceType, setRaceType] = useState<string>(saved?.raceType ?? "中央競馬");
  const [statusFilter, setStatusFilter] = useState<DerivedStatus | "total" | null>(saved?.statusFilter ?? null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>(BULK_STATUS_OPTIONS[0]);
  const [reanalyzeRace, setReanalyzeRace] = useState<Race | null>(null);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();

  useEffect(() => {
    if (date) return;
    fetch(`${API}/races/latest-date`)
      .then((r) => r.json())
      .then((data) => {
        if (data.date) setDate(data.date);
      })
      .catch(() => {
        setDate(format(new Date(), "yyyy-MM-dd"));
      });
  }, []);

  useEffect(() => {
    if (!date) return;
    sessionStorage.setItem(RACE_LIST_STATE_KEY, JSON.stringify({ date, venue, raceType, statusFilter }));
  }, [date, venue, raceType, statusFilter]);

  // Always fetch all races for date+type, filter by venue client-side
  const queryParams = {
    date,
    race_type: raceType,
  };

  const { data: allRaces, isLoading: isRacesLoading, refetch } = useGetRaces(
    queryParams,
    { query: { queryKey: getGetRacesQueryKey(queryParams) } }
  );

  // Client-side venue filter
  const races = useMemo(() => {
    if (!allRaces) return [];
    if (venue === "all") return allRaces;
    return allRaces.filter((r) => r.venue === venue);
  }, [allRaces, venue]);

  const venueOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "all", label: "すべて" }];
    const seen = new Set<string>();
    (allRaces || []).forEach((r) => {
      if (!seen.has(r.venue)) {
        seen.add(r.venue);
        opts.push({ value: r.venue, label: r.venue });
      }
    });
    return opts;
  }, [allRaces]);

  const handleRaceTypeChange = (val: string) => {
    setRaceType(val);
    setVenue("all");
    setCheckedIds(new Set());
  };

  const handleDateChange = (val: string) => {
    setDate(val);
    setVenue("all");
    setCheckedIds(new Set());
    setStatusFilter(null);
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { total: 0 };
    ALL_STATUS_CARDS.forEach((c) => { counts[c.key] = 0; });
    races.forEach((race) => {
      const ds = getDerivedStatus(race);
      counts[ds] = (counts[ds] || 0) + 1;
      counts["total"] = (counts["total"] || 0) + 1;
    });
    return counts;
  }, [races]);

  const filteredRaces = useMemo(() => {
    if (!statusFilter || statusFilter === "total") return races;
    return races.filter((r) => getDerivedStatus(r) === statusFilter);
  }, [races, statusFilter]);

  const eligibleIds = useMemo(
    () => filteredRaces.filter((r) => isSelectable(getDerivedStatus(r))).map((r) => r.id),
    [filteredRaces]
  );

  const allChecked = eligibleIds.length > 0 && eligibleIds.every((id) => checkedIds.has(id));
  const someChecked = eligibleIds.some((id) => checkedIds.has(id));

  const toggleAll = () => {
    if (allChecked) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        eligibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        eligibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const toggleRow = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = filteredRaces
    .filter((r) => checkedIds.has(r.id) && isSelectable(getDerivedStatus(r)))
    .map((r) => r.id);

  const batchUpdateMutation = useBatchUpdateRaces();
  const reanalyzeMutation = useReanalyzeRace();

  const handleBulkUpdate = () => {
    if (selectedIds.length === 0) return;
    batchUpdateMutation.mutate(
      { data: { race_ids: selectedIds, status: bulkStatus } },
      {
        onSuccess: () => {
          setCheckedIds(new Set());
          queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey(queryParams) });
        },
      }
    );
  };

  const handleReanalyze = (_preset: string) => {
    if (!reanalyzeRace) return;
    reanalyzeMutation.mutate(
      { raceId: reanalyzeRace.id },
      {
        onSuccess: () => {
          setReanalyzeRace(null);
          queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey(queryParams) });
        },
      }
    );
  };

  const handleCompleteAnalysis = async (raceId: string) => {
    setCompletingIds((prev) => new Set(prev).add(raceId));
    try {
      const res = await fetch(`${API}/races/${raceId}/complete-analysis`, { method: "POST" });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey(queryParams) });
        toast({ title: "解析完了。待機中に変更されました。" });
      } else {
        toast({ title: "完了処理に失敗しました", variant: "destructive" });
      }
    } catch {
      toast({ title: "通信エラーが発生しました", variant: "destructive" });
    } finally {
      setCompletingIds((prev) => { const s = new Set(prev); s.delete(raceId); return s; });
    }
  };

  const totalCount = statusCounts["total"] || 0;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-3 flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <h1 className="text-base font-semibold text-foreground">
              {formatDateTitle(date)}
            </h1>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 cursor-pointer"
              onClick={() => refetch()}
              title="更新"
            >
              <RefreshCcw className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 cursor-pointer"
              onClick={() => allRaces && downloadCSV(venue === "all" ? allRaces : races, venue)}
              title="CSV出力"
            >
              <Download className="h-3 w-3" />
              CSV出力
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="date"
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-[150px] h-8 text-sm cursor-pointer"
            />
            <Select value={raceType} onValueChange={handleRaceTypeChange}>
              <SelectTrigger className="w-[130px] h-8 text-sm cursor-pointer">
                <SelectValue placeholder="競馬種別" />
              </SelectTrigger>
              <SelectContent>
                {RACE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={venue}
              onValueChange={(v) => { setVenue(v); setCheckedIds(new Set()); }}
            >
              <SelectTrigger className="w-[120px] h-8 text-sm cursor-pointer">
                <SelectValue placeholder="会場" />
              </SelectTrigger>
              <SelectContent>
                {venueOptions.map((v) => (
                  <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Status filter — 2-row grid */}
      <div className="px-6 py-3">
        <div className="flex gap-2 items-stretch">
          <button
            onClick={() => setStatusFilter(statusFilter === "total" ? null : "total")}
            className={`flex flex-col items-center justify-center px-5 py-2 rounded-md border text-center transition-colors min-w-[80px] cursor-pointer ${
              statusFilter === "total"
                ? "bg-primary/20 border-primary"
                : "bg-card border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <span className="text-[10px] text-muted-foreground whitespace-nowrap leading-tight">総レース</span>
            <span className="text-2xl font-bold text-foreground mt-0.5">{totalCount}</span>
          </button>

          <div className="flex-1 flex flex-col gap-1.5">
            {[STATUS_ROW1, STATUS_ROW2].map((row, ri) => (
              <div key={ri} className="grid grid-cols-5 gap-1.5">
                {row.map((card) => {
                  const count = statusCounts[card.key] || 0;
                  const isActive = statusFilter === card.key;
                  const isAlert = ALERT_STATUSES.has(card.key) && count >= 1;
                  const isHighlight = !isAlert && HIGHLIGHT_STATUSES.has(card.key) && count > 0;
                  const alertStyle = isAlert ? ALERT_STYLE_MAP[card.key] : null;
                  return (
                    <button
                      key={card.key}
                      onClick={() => setStatusFilter(isActive ? null : card.key)}
                      className={`flex items-center justify-between px-3 py-1.5 rounded-md border text-left transition-all cursor-pointer ${
                        isActive
                          ? "bg-primary/20 border-primary ring-1 ring-primary/40"
                          : alertStyle
                            ? `${alertStyle.bg} ${alertStyle.border} ${alertStyle.hoverBorder} ${alertStyle.hoverBg} ${alertStyle.shadow} animate-pulse-subtle`
                            : isHighlight
                              ? "bg-zinc-800/60 border-zinc-600 hover:border-zinc-400"
                              : "bg-card border-border hover:border-primary/50 hover:bg-muted/30"
                      }`}
                    >
                      <span className={`flex items-center gap-1 text-[11px] whitespace-nowrap ${alertStyle ? `${alertStyle.textColor} font-semibold` : isHighlight ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {isAlert && <AlertTriangle className="h-3 w-3 flex-shrink-0" />}
                        {card.label}
                      </span>
                      <span className={`text-base font-bold ml-2 ${card.colorClass}`}>{count}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bulk action bar — admin only */}
      {isAdmin && selectedIds.length > 0 && (
        <div className="mx-6 mb-2 flex items-center gap-3 bg-primary/10 border border-primary/30 rounded-md px-4 py-2">
          <span className="text-xs text-muted-foreground">{selectedIds.length}件選択中</span>
          <Select value={bulkStatus} onValueChange={setBulkStatus}>
            <SelectTrigger className="w-[140px] h-7 text-xs cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BULK_STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-7 text-xs cursor-pointer"
            onClick={handleBulkUpdate}
            disabled={batchUpdateMutation.isPending}
          >
            {batchUpdateMutation.isPending ? "更新中..." : "一括変更"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs ml-auto cursor-pointer"
            onClick={() => setCheckedIds(new Set())}
          >
            選択解除
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 px-6 pb-6 overflow-hidden flex flex-col min-h-0">
        <div className="rounded-md border border-border bg-card flex-1 overflow-auto">
          <Table className="w-full table-fixed">
            <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur">
              <TableRow>
                <TableHead style={{ width: "6%" }} className="text-center text-xs">競馬場</TableHead>
                <TableHead style={{ width: "4%" }} className="text-center text-xs">R</TableHead>
                <TableHead style={{ width: "6.5%" }} className="text-xs">出走時刻</TableHead>
                <TableHead style={{ width: "14%" }} className="text-xs">レース名</TableHead>
                <TableHead style={{ width: "4%" }} className="text-center text-xs">芝ダ</TableHead>
                <TableHead style={{ width: "6%" }} className="text-center text-xs">距離</TableHead>
                <TableHead style={{ width: "7%" }} className="text-center text-xs">動画</TableHead>
                {isAdmin && (
                  <TableHead style={{ width: "4%" }} className="text-center">
                    <Checkbox
                      checked={allChecked ? true : someChecked ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                      aria-label="全選択"
                      className="cursor-pointer"
                    />
                  </TableHead>
                )}
                <TableHead style={{ width: isAdmin ? "10%" : "14%" }} className="text-xs">ステータス</TableHead>
                <TableHead style={{ width: "8%" }} className="text-xs">担当者</TableHead>
                <TableHead style={{ width: "6.5%" }} className="text-xs">更新時間</TableHead>
                <TableHead style={{ width: "24%" }} className="text-center text-xs">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isRacesLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: isAdmin ? 12 : 11 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredRaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 12 : 11} className="h-32 text-center text-muted-foreground text-sm">
                    該当するレースが見つかりません
                  </TableCell>
                </TableRow>
              ) : (
                filteredRaces.map((race) => {
                  const derivedStatus = getDerivedStatus(race);
                  const badgeProps = getStatusBadgeProps(derivedStatus);
                  const isTurf = race.surface_type === "芝";
                  const videoComplete = race.video_status === "完了";
                  const canSelect = isSelectable(derivedStatus);
                  const isChecked = checkedIds.has(race.id);
                  const canReanalyze = derivedStatus === "解析失敗" || derivedStatus === "再解析要請";
                  const isAnalyzing = derivedStatus === "解析中";
                  const isCompleting = completingIds.has(race.id);

                  const correctionDisabled = CORRECTION_DISABLED_STATUSES.includes(derivedStatus);

                  let opLabel = "データ補正";
                  let opColorClass = "bg-red-700 hover:bg-red-600 text-white border-0";
                  if (derivedStatus === "レビュー待ち") {
                    opLabel = "レビュー";
                    opColorClass = "bg-purple-700 hover:bg-purple-600 text-white border-0";
                  } else if (derivedStatus === "データ確定") {
                    opLabel = "再補正";
                    opColorClass = "bg-blue-700 hover:bg-blue-600 text-white border-0";
                  }

                  const opActionBlocked = !isAdmin && (derivedStatus === "レビュー待ち" || derivedStatus === "データ確定");
                  const reanalyzeBlocked = !isAdmin;

                  let updatedTime = "-";
                  if (race.updated_at) {
                    try {
                      const d = new Date(race.updated_at);
                      updatedTime = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
                    } catch {}
                  }

                  return (
                    <TableRow key={race.id} className={`hover:bg-muted/30 ${isChecked ? "bg-primary/5" : ""}`}>
                      <TableCell className="text-xs text-center font-medium">{race.venue}</TableCell>
                      <TableCell className="text-xs text-center font-bold">{race.race_number}R</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{race.start_time?.substring(0, 5) || "-"}</TableCell>
                      <TableCell className="text-xs font-medium truncate">{race.race_name}</TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs font-bold ${isTurf ? "text-green-400" : "text-amber-500"}`}>
                          {isTurf ? "芝" : "ダ"}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-center text-muted-foreground">{race.distance}m</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-normal border ${
                            videoComplete
                              ? "bg-green-900/40 text-green-400 border-green-800"
                              : "bg-zinc-800/60 text-zinc-500 border-zinc-700"
                          }`}
                        >
                          {videoComplete ? "完了" : "未完了"}
                        </Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-center">
                          {canSelect ? (
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleRow(race.id)}
                              aria-label={`${race.race_number}R選択`}
                              className="cursor-pointer"
                            />
                          ) : (
                            <span className="block w-4 h-4" />
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] font-normal border ${badgeProps.className}`}>
                          {badgeProps.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate">{race.assigned_user || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{updatedTime}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-center">
                          {correctionDisabled || opActionBlocked ? (
                            <Button
                              size="sm"
                              disabled
                              className={`h-6 text-[11px] px-2 opacity-30 cursor-not-allowed ${opColorClass}`}
                            >
                              {opLabel}
                            </Button>
                          ) : (
                            <Link href={`/races/${race.id}`}>
                              <Button
                                size="sm"
                                className={`h-6 text-[11px] px-2 cursor-pointer ${opColorClass}`}
                              >
                                {opLabel}
                              </Button>
                            </Link>
                          )}
                          {isAnalyzing ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[11px] px-2 flex items-center gap-0.5 border-cyan-700 text-cyan-400 hover:bg-cyan-900/20 cursor-pointer"
                              disabled={isCompleting}
                              onClick={() => handleCompleteAnalysis(race.id)}
                              title="解析完了にする"
                            >
                              <RefreshCw className={`h-3 w-3 ${isCompleting ? "animate-spin" : ""}`} />
                              完了
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-6 text-[11px] px-2 flex items-center gap-0.5 ${
                                canReanalyze && !reanalyzeBlocked
                                  ? "border-red-700 text-red-400 hover:bg-red-900/20 cursor-pointer"
                                  : "opacity-30 cursor-not-allowed"
                              }`}
                              disabled={!canReanalyze || reanalyzeBlocked}
                              onClick={() => canReanalyze && !reanalyzeBlocked && setReanalyzeRace(race)}
                            >
                              <RotateCcw className="h-3 w-3" />
                              再解析
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {reanalyzeRace && (
        <ReanalyzeDialog
          race={reanalyzeRace}
          onClose={() => setReanalyzeRace(null)}
          onExecute={handleReanalyze}
          isLoading={reanalyzeMutation.isPending}
        />
      )}
    </div>
  );
}
