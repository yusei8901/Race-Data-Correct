import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Calendar, RefreshCcw, AlertTriangle, Download, RefreshCw } from "lucide-react";
import {
  useGetRaces,
  getGetRacesQueryKey,
  useGetRaceSummary,
  getGetRaceSummaryQueryKey,
  useBatchUpdateRaces,
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
// Internal DB code → display label mapping (11 statuses)
type DerivedStatus =
  | "未処理"
  | "解析中"
  | "解析失敗"
  | "待機中"
  | "突合失敗"
  | "補正中"
  | "レビュー待ち"
  | "修正要請"
  | "データ確定"
  | "再解析要請";

const KNOWN_STATUSES: ReadonlySet<DerivedStatus> = new Set<DerivedStatus>([
  "未処理", "解析中", "解析失敗", "待機中", "突合失敗",
  "補正中", "レビュー待ち", "修正要請", "データ確定", "再解析要請",
]);

function getDerivedStatus(race: Race): DerivedStatus {
  const ds = race.display_status ?? "";
  if (ds && KNOWN_STATUSES.has(ds as DerivedStatus)) {
    return ds as DerivedStatus;
  }
  const st = race.status ?? "";
  switch (st) {
    case "PENDING":            return "未処理";
    case "ANALYZING":          return "解析中";
    case "ANALYSIS_FAILED":    return "解析失敗";
    case "ANALYZED":           return "待機中";
    case "MATCH_FAILED":       return "突合失敗";
    case "CORRECTING":         return "補正中";
    case "CORRECTED":          return "レビュー待ち";
    case "REVISION_REQUESTED": return "修正要請";
    case "CONFIRMED":          return "データ確定";
    case "ANALYSIS_REQUESTED": return "再解析要請";
    default:                   return "未処理";
  }
}

function getStatusBadgeProps(status: DerivedStatus) {
  switch (status) {
    case "未処理":       return { className: "bg-zinc-800/60 text-zinc-400 border-zinc-700", label: "未処理" };
    case "解析中":       return { className: "bg-cyan-900/40 text-cyan-400 border-cyan-800", label: "解析中" };
    case "解析失敗":     return { className: "bg-red-900/50 text-red-400 border-red-800", label: "解析失敗" };
    case "待機中":       return { className: "bg-cyan-900/30 text-cyan-300 border-cyan-900", label: "待機中" };
    case "突合失敗":     return { className: "bg-red-950/60 text-red-400 border-red-900", label: "突合失敗" };
    case "補正中":       return { className: "bg-cyan-900/50 text-cyan-400 border-cyan-800", label: "補正中" };
    case "再解析要請":   return { className: "bg-red-900/40 text-red-400 border-red-800", label: "再解析要請" };
    case "レビュー待ち": return { className: "bg-purple-900/40 text-purple-400 border-purple-800", label: "レビュー待ち" };
    case "修正要請":     return { className: "bg-orange-900/40 text-orange-400 border-orange-800", label: "修正要請" };
    case "データ確定":   return { className: "bg-green-900/40 text-green-400 border-green-800", label: "データ確定" };
    default:             return { className: "bg-muted text-muted-foreground border-muted-border", label: status };
  }
}

const SELECTABLE_STATUSES: DerivedStatus[] = ["データ確定", "レビュー待ち", "修正要請", "補正中", "待機中"];
const BULK_STATUS_OPTIONS: DerivedStatus[] = ["データ確定", "レビュー待ち", "修正要請", "補正中", "待機中"];

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

function getCourse(race: Race): string {
  const surface = race.surface_type || "-";
  const dir = (race.direction || "").replace("回り", "");
  return dir ? `${surface}・${dir}` : surface;
}

function formatGoalTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
}

const VIDEO_SELECTABLE_STATUSES = new Set(["NEEDS_SETUP", "STANDBY"]);
const VIDEO_BULK_OPTIONS: { value: string; label: string }[] = [
  { value: "NEEDS_SETUP", label: "解析未設定" },
  { value: "STANDBY",     label: "準備完了" },
];

function isVideoSelectable(race: Race): boolean {
  return VIDEO_SELECTABLE_STATUSES.has(race.video_raw_status || "");
}

function getVideoBadgeProps(displayStatus: string | null | undefined) {
  switch (displayStatus) {
    case "完了":       return { className: "bg-green-900/40 text-green-400 border-green-800",   label: "完了" };
    case "準備完了":   return { className: "bg-cyan-900/40 text-cyan-400 border-cyan-800",     label: "準備完了" };
    case "解析未設定": return { className: "bg-amber-900/40 text-amber-400 border-amber-800",  label: "解析未設定" };
    case "未完了":     return { className: "bg-zinc-800/60 text-zinc-500 border-zinc-700",     label: "未完了" };
    default:           return { className: "bg-zinc-800/60 text-zinc-500 border-zinc-700",     label: displayStatus || "-" };
  }
}

const ALERT_STATUSES: Set<string> = new Set(["修正要請", "解析失敗", "再解析要請", "突合失敗"]);
const HIGHLIGHT_STATUSES: Set<string> = new Set([...ALERT_STATUSES, "未処理"]);

const ALERT_STYLE_MAP: Record<string, { bg: string; border: string; hoverBorder: string; hoverBg: string; shadow: string; textColor: string }> = {
  "修正要請":   { bg: "bg-orange-950/80", border: "border-orange-500", hoverBorder: "hover:border-orange-300", hoverBg: "hover:bg-orange-900/60", shadow: "shadow-[0_0_10px_rgba(249,115,22,0.45)]", textColor: "text-orange-200" },
  "解析失敗":   { bg: "bg-red-950/80",    border: "border-red-500",    hoverBorder: "hover:border-red-300",    hoverBg: "hover:bg-red-900/60",    shadow: "shadow-[0_0_10px_rgba(239,68,68,0.45)]",  textColor: "text-red-200" },
  "再解析要請": { bg: "bg-red-950/80",    border: "border-red-500",    hoverBorder: "hover:border-red-300",    hoverBg: "hover:bg-red-900/60",    shadow: "shadow-[0_0_10px_rgba(239,68,68,0.45)]",  textColor: "text-red-200" },
  "突合失敗":   { bg: "bg-red-950/80",    border: "border-red-600",    hoverBorder: "hover:border-red-400",    hoverBg: "hover:bg-red-900/60",    shadow: "shadow-[0_0_10px_rgba(239,68,68,0.45)]",  textColor: "text-red-200" },
};

type FilterKey = string;

interface StatusFilterDef {
  key: FilterKey;
  label: string;
  colorClass: string;
  matchStatuses: DerivedStatus[];
}

const STATUS_ROW1: StatusFilterDef[] = [
  { key: "データ確定",   label: "データ確定",   colorClass: "text-green-400",  matchStatuses: ["データ確定"] },
  { key: "補正中",       label: "補正中",       colorClass: "text-cyan-400",   matchStatuses: ["補正中"] },
  { key: "解析中",       label: "解析中",       colorClass: "text-cyan-400",   matchStatuses: ["解析中"] },
  { key: "修正要請",     label: "修正要請",     colorClass: "text-orange-400", matchStatuses: ["修正要請"] },
  { key: "突合失敗",     label: "突合失敗",     colorClass: "text-red-400",    matchStatuses: ["突合失敗"] },
];

const STATUS_ROW2: StatusFilterDef[] = [
  { key: "レビュー待ち", label: "レビュー待ち", colorClass: "text-purple-400", matchStatuses: ["レビュー待ち"] },
  { key: "待機中",       label: "待機中",       colorClass: "text-cyan-300",   matchStatuses: ["待機中"] },
  { key: "未処理",       label: "未処理",       colorClass: "text-zinc-400",   matchStatuses: ["未処理"] },
  { key: "再解析要請",   label: "再解析要請",   colorClass: "text-red-400",    matchStatuses: ["再解析要請"] },
  { key: "解析失敗",     label: "解析失敗",     colorClass: "text-red-400",    matchStatuses: ["解析失敗"] },
];

const ALL_STATUS_CARDS = [...STATUS_ROW1, ...STATUS_ROW2];

function getOperationConfig(status: DerivedStatus, isAdmin: boolean): { label: string; colorClass: string; disabled: boolean; adminOnly: boolean } {
  switch (status) {
    case "データ確定":
      return { label: "再補正", colorClass: "bg-green-700 hover:bg-green-600 text-white border-0", disabled: false, adminOnly: true };
    case "レビュー待ち":
      return { label: "レビュー", colorClass: "bg-purple-700 hover:bg-purple-600 text-white border-0", disabled: false, adminOnly: true };
    case "再解析要請":
      return { label: "レース詳細", colorClass: "bg-orange-700 hover:bg-orange-600 text-white border-0", disabled: false, adminOnly: true };
    case "突合失敗":
      return { label: "レース詳細", colorClass: "bg-orange-700 hover:bg-orange-600 text-white border-0", disabled: false, adminOnly: true };
    case "解析中":
      return { label: "解析中", colorClass: "bg-zinc-700 text-white border-0", disabled: true, adminOnly: false };
    default:
      return { label: "レース詳細", colorClass: "bg-orange-700 hover:bg-orange-600 text-white border-0", disabled: false, adminOnly: false };
  }
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
  const [statusFilter, setStatusFilter] = useState<FilterKey | "total" | null>(saved?.statusFilter ?? null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>(BULK_STATUS_OPTIONS[0]);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [videoCheckedIds, setVideoCheckedIds] = useState<Set<string>>(new Set());
  const [videoBulkStatus, setVideoBulkStatus] = useState<string>("STANDBY");
  const [videoBulkConfirmOpen, setVideoBulkConfirmOpen] = useState(false);

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
    const perStatus: Record<string, number> = {};
    let total = 0;
    races.forEach((race) => {
      const ds = getDerivedStatus(race);
      perStatus[ds] = (perStatus[ds] || 0) + 1;
      total++;
    });
    const counts: Record<string, number> = { total };
    ALL_STATUS_CARDS.forEach((c) => {
      counts[c.key] = c.matchStatuses.reduce((sum, s) => sum + (perStatus[s] || 0), 0);
    });
    return counts;
  }, [races]);

  const activeFilterCard = useMemo(() => {
    if (!statusFilter || statusFilter === "total") return null;
    return ALL_STATUS_CARDS.find((c) => c.key === statusFilter) ?? null;
  }, [statusFilter]);

  const filteredRaces = useMemo(() => {
    if (!statusFilter || statusFilter === "total") return races;
    if (!activeFilterCard) return races;
    const matchSet = new Set(activeFilterCard.matchStatuses);
    return races.filter((r) => matchSet.has(getDerivedStatus(r)));
  }, [races, statusFilter, activeFilterCard]);

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

  const handleBulkUpdate = () => {
    if (selectedIds.length === 0) return;
    setBulkConfirmOpen(true);
  };

  const executeBulkUpdate = () => {
    setBulkConfirmOpen(false);
    batchUpdateMutation.mutate(
      { data: { race_ids: selectedIds, status: bulkStatus } },
      {
        onSuccess: () => {
          setCheckedIds(new Set());
          queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey(queryParams) });
          toast({ title: `${selectedIds.length}件のレースを「${bulkStatus}」に変更しました` });
        },
        onError: () => {
          toast({ title: "一括変更に失敗しました", variant: "destructive" });
        },
      }
    );
  };

  const bulkConfirmRaces = useMemo(() => {
    if (!bulkConfirmOpen) return [];
    return filteredRaces
      .filter((r) => selectedIds.includes(r.id))
      .map((r) => ({
        label: `${r.venue} ${r.race_number}R ${r.race_name}`,
        currentStatus: getDerivedStatus(r),
      }));
  }, [bulkConfirmOpen, filteredRaces, selectedIds]);

  // ── Video bulk update helpers ──
  const videoSelectableIds = useMemo(
    () => filteredRaces.filter((r) => isVideoSelectable(r)).map((r) => r.id),
    [filteredRaces],
  );
  const videoAllChecked = videoSelectableIds.length > 0 && videoSelectableIds.every((id) => videoCheckedIds.has(id));
  const videoSomeChecked = videoSelectableIds.some((id) => videoCheckedIds.has(id));

  const toggleVideoRow = (id: string) => {
    setVideoCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVideo = (checked: boolean | "indeterminate") => {
    if (checked === true) setVideoCheckedIds(new Set(videoSelectableIds));
    else setVideoCheckedIds(new Set());
  };

  const videoSelectedIds = filteredRaces
    .filter((r) => videoCheckedIds.has(r.id) && isVideoSelectable(r))
    .map((r) => r.id);

  const handleVideoBulkUpdate = () => {
    if (videoSelectedIds.length === 0) return;
    setVideoBulkConfirmOpen(true);
  };

  const executeVideoBulkUpdate = async () => {
    setVideoBulkConfirmOpen(false);
    try {
      const res = await fetch(`${API}/races/batch-update-video`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ race_ids: videoSelectedIds, status: videoBulkStatus }),
      });
      if (res.ok) {
        setVideoCheckedIds(new Set());
        queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey(queryParams) });
        toast({ title: `${videoSelectedIds.length}件の動画ステータスを変更しました` });
      } else {
        toast({ title: "動画ステータス変更に失敗しました", variant: "destructive" });
      }
    } catch {
      toast({ title: "通信エラーが発生しました", variant: "destructive" });
    }
  };

  const videoBulkConfirmRaces = useMemo(() => {
    if (!videoBulkConfirmOpen) return [];
    return filteredRaces
      .filter((r) => videoSelectedIds.includes(r.id))
      .map((r) => ({
        label: `${r.venue} ${r.race_number}R`,
        currentVideoStatus: r.video_display_status || "-",
      }));
  }, [videoBulkConfirmOpen, filteredRaces, videoSelectedIds]);

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

      {/* Bulk action bar — race status */}
      {isAdmin && selectedIds.length > 0 && (
        <div className="mx-6 mb-1 flex items-center gap-3 bg-primary/10 border border-primary/30 rounded-md px-4 py-2">
          <span className="text-xs text-muted-foreground font-medium">レース {selectedIds.length}件選択中</span>
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
          <Button size="sm" className="h-7 text-xs cursor-pointer" onClick={handleBulkUpdate} disabled={batchUpdateMutation.isPending}>
            {batchUpdateMutation.isPending ? "更新中..." : "一括変更"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto cursor-pointer" onClick={() => setCheckedIds(new Set())}>
            選択解除
          </Button>
        </div>
      )}

      {/* Bulk action bar — video status */}
      {isAdmin && videoSelectedIds.length > 0 && (
        <div className="mx-6 mb-2 flex items-center gap-3 bg-blue-950/30 border border-blue-800/50 rounded-md px-4 py-2">
          <span className="text-xs text-blue-300 font-medium">動画 {videoSelectedIds.length}件選択中</span>
          <Select value={videoBulkStatus} onValueChange={setVideoBulkStatus}>
            <SelectTrigger className="w-[140px] h-7 text-xs cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_BULK_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7 text-xs cursor-pointer bg-blue-700 hover:bg-blue-600 text-white border-0" onClick={handleVideoBulkUpdate}>
            動画ステータス変更
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto cursor-pointer" onClick={() => setVideoCheckedIds(new Set())}>
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
                <TableHead style={{ width: "5%" }} className="text-center text-xs">競馬場</TableHead>
                <TableHead style={{ width: "4%" }} className="text-center text-xs">R</TableHead>
                <TableHead style={{ width: "9%" }} className="text-center text-xs">レースID</TableHead>
                <TableHead style={{ width: "8%" }} className="text-center text-xs">コース</TableHead>
                <TableHead style={{ width: "5%" }} className="text-center text-xs">距離</TableHead>
                {isAdmin && (
                  <TableHead style={{ width: "3%" }} className="text-center">
                    <Checkbox
                      checked={videoAllChecked ? true : videoSomeChecked ? "indeterminate" : false}
                      onCheckedChange={toggleAllVideo}
                      aria-label="動画全選択"
                      className="cursor-pointer"
                    />
                  </TableHead>
                )}
                <TableHead style={{ width: "7%" }} className="text-center text-xs">動画</TableHead>
                {isAdmin && (
                  <TableHead style={{ width: "3%" }} className="text-center">
                    <Checkbox
                      checked={allChecked ? true : someChecked ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                      aria-label="全選択"
                      className="cursor-pointer"
                    />
                  </TableHead>
                )}
                <TableHead style={{ width: "10%" }} className="text-xs">ステータス</TableHead>
                <TableHead style={{ width: "7%" }} className="text-xs">担当者</TableHead>
                <TableHead style={{ width: "5%" }} className="text-xs">更新時間</TableHead>
                <TableHead style={{ width: "11%" }} className="text-xs">解析オプション</TableHead>
                <TableHead style={{ width: isAdmin ? "23%" : "29%" }} className="text-center text-xs">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isRacesLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: isAdmin ? 13 : 11 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredRaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 13 : 11} className="h-32 text-center text-muted-foreground text-sm">
                    該当するレースが見つかりません
                  </TableCell>
                </TableRow>
              ) : (
                filteredRaces.map((race) => {
                  const derivedStatus = getDerivedStatus(race);
                  const badgeProps = getStatusBadgeProps(derivedStatus);
                  const videoBadge = getVideoBadgeProps(race.video_display_status);
                  const canSelect = isSelectable(derivedStatus);
                  const canSelectVideo = isVideoSelectable(race);
                  const isChecked = checkedIds.has(race.id);
                  const isVideoChecked = videoCheckedIds.has(race.id);
                  const isAnalyzing = derivedStatus === "解析中";
                  const isCompleting = completingIds.has(race.id);

                  const opConfig = getOperationConfig(derivedStatus, isAdmin);
                  const opBlocked = opConfig.disabled || (opConfig.adminOnly && !isAdmin);

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
                      <TableCell className="text-xs text-center font-mono text-muted-foreground">
                        {race.race_id_num != null ? String(race.race_id_num).padStart(10, "0") : "-"}
                      </TableCell>
                      <TableCell className="text-xs text-center text-muted-foreground">{getCourse(race)}</TableCell>
                      <TableCell className="text-xs text-center text-muted-foreground">{race.distance}m</TableCell>
                      {isAdmin && (
                        <TableCell className="text-center">
                          {canSelectVideo ? (
                            <Checkbox
                              checked={isVideoChecked}
                              onCheckedChange={() => toggleVideoRow(race.id)}
                              aria-label={`${race.race_number}R動画選択`}
                              className="cursor-pointer"
                            />
                          ) : (
                            <span className="block w-4 h-4" />
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`text-[10px] font-normal border ${videoBadge.className}`}>
                          {videoBadge.label}
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
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="outline" className={`text-[10px] font-normal border ${badgeProps.className} w-fit`}>
                            {badgeProps.label}
                          </Badge>
                          {derivedStatus === "解析失敗" && race.analysis_failure_reason && (
                            <span className="text-[9px] text-red-400/80 leading-tight text-center block">
                              {race.analysis_failure_reason}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate">{race.assigned_user || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{updatedTime}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <div className="text-[9px] text-zinc-500 leading-none">ゴールタイム</div>
                          <div className="text-[10px] font-mono text-zinc-300 leading-none">
                            {race.video_goal_time_raw != null ? formatGoalTime(race.video_goal_time_raw) : "-"}
                          </div>
                          <div className="text-[9px] text-zinc-500 leading-none mt-0.5">解析プリセット</div>
                          <div className="text-[10px] text-zinc-300 leading-none truncate">
                            {race.preset_name || "-"}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-center">
                          {opBlocked ? (
                            <Button
                              size="sm"
                              disabled
                              className={`h-6 text-[11px] px-2 opacity-30 cursor-not-allowed ${opConfig.colorClass}`}
                            >
                              {opConfig.label}
                            </Button>
                          ) : (
                            <Link href={`/races/${race.id}`}>
                              <Button
                                size="sm"
                                className={`h-6 text-[11px] px-2 cursor-pointer ${opConfig.colorClass}`}
                              >
                                {opConfig.label}
                              </Button>
                            </Link>
                          )}
                          {isAnalyzing && (
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

      {bulkConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[560px] max-w-[95vw] p-6">
            <h2 className="text-sm font-semibold mb-3">一括ステータス変更の確認</h2>
            <p className="text-xs text-muted-foreground mb-2">
              以下の{bulkConfirmRaces.length}件のレースのステータスを変更します。
            </p>
            <div className="max-h-[240px] overflow-auto bg-zinc-800/60 border border-zinc-700 rounded p-2 mb-4 space-y-0.5">
              {bulkConfirmRaces.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-0.5 gap-2">
                  <span className="text-zinc-300 truncate">{item.label}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${getStatusBadgeProps(item.currentStatus).className}`}>
                      {item.currentStatus}
                    </span>
                    <span className="text-zinc-500 text-[10px]">→</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${getStatusBadgeProps(bulkStatus as DerivedStatus).className}`}>
                      {bulkStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setBulkConfirmOpen(false)} className="h-8 text-xs cursor-pointer">キャンセル</Button>
              <Button size="sm" onClick={executeBulkUpdate} disabled={batchUpdateMutation.isPending} className="h-8 text-xs cursor-pointer bg-primary hover:bg-primary/90">
                {batchUpdateMutation.isPending ? "変更中..." : "変更する"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {videoBulkConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-zinc-900 border border-blue-800/50 rounded-lg shadow-2xl w-[500px] max-w-[95vw] p-6">
            <h2 className="text-sm font-semibold mb-3 text-blue-300">動画ステータス一括変更の確認</h2>
            <p className="text-xs text-muted-foreground mb-2">
              以下の{videoBulkConfirmRaces.length}件の動画ステータスを変更します。
            </p>
            <div className="max-h-[240px] overflow-auto bg-zinc-800/60 border border-zinc-700 rounded p-2 mb-4 space-y-0.5">
              {videoBulkConfirmRaces.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-0.5 gap-2">
                  <span className="text-zinc-300 truncate">{item.label}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${getVideoBadgeProps(item.currentVideoStatus).className}`}>
                      {item.currentVideoStatus}
                    </span>
                    <span className="text-zinc-500 text-[10px]">→</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${getVideoBadgeProps(VIDEO_BULK_OPTIONS.find(o => o.value === videoBulkStatus)?.label).className}`}>
                      {VIDEO_BULK_OPTIONS.find(o => o.value === videoBulkStatus)?.label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setVideoBulkConfirmOpen(false)} className="h-8 text-xs cursor-pointer">キャンセル</Button>
              <Button size="sm" onClick={executeVideoBulkUpdate} className="h-8 text-xs cursor-pointer bg-blue-700 hover:bg-blue-600 text-white border-0">
                変更する
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
