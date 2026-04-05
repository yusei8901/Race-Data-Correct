import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Calendar, RefreshCcw, AlertTriangle, X, RotateCcw } from "lucide-react";
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

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---- Status Matrix ----
type DerivedStatus =
  | "未処理"
  | "未解析"
  | "解析中"
  | "再解析中"
  | "待機中"
  | "補正中"
  | "レビュー待ち"
  | "データ確定"
  | "修正要請"
  | "解析失敗"
  | "再解析要請"
  | "突合失敗";

function getDerivedStatus(race: Race): DerivedStatus {
  const vs = race.video_status ?? "";
  const as_ = race.analysis_status ?? "";
  const st = race.status ?? "";

  if (vs !== "完了") return "未処理";
  if (as_ === "未" || as_ === "") return "未解析";
  if (as_ === "解析中") return "解析中";
  if (as_ === "再解析中") return "再解析中";
  if (as_ === "解析失敗") {
    if (st === "再解析要請") return "再解析要請";
    return "解析失敗";
  }
  if (as_ === "突合失敗") return "突合失敗";
  if (as_ === "完了") {
    if (st === "待機中" || st === "未補正") return "待機中";
    if (st === "補正中") return "補正中";
    if (st === "レビュー待ち") return "レビュー待ち";
    if (st === "データ確定") return "データ確定";
    if (st === "修正要請") return "修正要請";
    if (st === "補正完了" || st === "データ補正") return "待機中";
    if (st === "レビュー") return "レビュー待ち";
    if (st === "修正要求") return "修正要請";
    return "待機中";
  }
  return "未処理";
}

function getStatusBadgeProps(status: DerivedStatus) {
  switch (status) {
    case "未処理":       return { className: "bg-zinc-800/60 text-zinc-400 border-zinc-700", label: "未処理" };
    case "未解析":       return { className: "bg-slate-800/60 text-slate-400 border-slate-700", label: "未解析" };
    case "解析中":       return { className: "bg-cyan-900/40 text-cyan-400 border-cyan-800", label: "解析中" };
    case "再解析中":     return { className: "bg-teal-900/40 text-teal-400 border-teal-800", label: "再解析中" };
    case "待機中":       return { className: "bg-yellow-900/40 text-yellow-400 border-yellow-800", label: "待機中" };
    case "補正中":       return { className: "bg-blue-900/40 text-blue-400 border-blue-800", label: "補正中" };
    case "レビュー待ち": return { className: "bg-purple-900/40 text-purple-400 border-purple-800", label: "レビュー待ち" };
    case "データ確定":   return { className: "bg-green-900/40 text-green-400 border-green-800", label: "データ確定" };
    case "修正要請":     return { className: "bg-orange-900/40 text-orange-400 border-orange-800", label: "修正要請" };
    case "解析失敗":     return { className: "bg-red-900/50 text-red-400 border-red-800", label: "解析失敗" };
    case "再解析要請":   return { className: "bg-rose-900/40 text-rose-400 border-rose-800", label: "再解析要請" };
    case "突合失敗":     return { className: "bg-red-950/60 text-red-300 border-red-900", label: "突合失敗" };
    default:             return { className: "bg-muted text-muted-foreground border-muted-border", label: status };
  }
}

// Statuses where the main operation button is disabled
const CORRECTION_DISABLED_STATUSES: DerivedStatus[] = [
  "未処理", "未解析", "解析中", "再解析中", "解析失敗",
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
  { key: "再解析中",     label: "再解析中",     colorClass: "text-teal-400" },
  { key: "突合失敗",     label: "突合失敗",     colorClass: "text-red-300" },
];

const ALL_STATUS_CARDS = [...STATUS_ROW1, ...STATUS_ROW2];

// Re-analysis dialog
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

export default function RaceList() {
  const { isAdmin } = useUserRole();

  const [date, setDate] = useState("");
  const [venue, setVenue] = useState<string>("all");
  const [raceType, setRaceType] = useState<string>("中央競馬");
  const [statusFilter, setStatusFilter] = useState<DerivedStatus | "total" | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>(BULK_STATUS_OPTIONS[0]);
  const [reanalyzeRace, setReanalyzeRace] = useState<Race | null>(null);

  const queryClient = useQueryClient();

  // Initialize date to the most recent race date in the DB
  useEffect(() => {
    fetch(`${BASE_URL}/fastapi/races/latest-date`)
      .then((r) => r.json())
      .then((data) => {
        if (data.date) setDate(data.date);
      })
      .catch(() => {
        setDate(format(new Date(), "yyyy-MM-dd"));
      });
  }, []);

  const queryParams = {
    date,
    venue: venue !== "all" ? venue : undefined,
    race_type: raceType,
  };

  const { data: races, isLoading: isRacesLoading, refetch } = useGetRaces(
    queryParams,
    { query: { queryKey: getGetRacesQueryKey(queryParams) } }
  );

  // Derive venue options from fetched races (already filtered by date + race_type)
  const venueOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "all", label: "全会場" }];
    const seen = new Set<string>();
    (races || []).forEach((r) => {
      if (!seen.has(r.venue)) {
        seen.add(r.venue);
        opts.push({ value: r.venue, label: r.venue });
      }
    });
    return opts;
  }, [races]);

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

  // Status counts for filter cards
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { total: 0 };
    ALL_STATUS_CARDS.forEach((c) => { counts[c.key] = 0; });
    (races || []).forEach((race) => {
      const ds = getDerivedStatus(race);
      counts[ds] = (counts[ds] || 0) + 1;
      counts["total"] = (counts["total"] || 0) + 1;
    });
    return counts;
  }, [races]);

  const filteredRaces = useMemo(() => {
    if (!races) return [];
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
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 cursor-pointer"
              onClick={() => refetch()}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Status filter — 2-row grid */}
      <div className="px-6 py-3">
        <div className="flex gap-2 items-stretch">
          {/* Total card */}
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

          {/* Right side: 2 rows × 5 status cards */}
          <div className="flex-1 flex flex-col gap-1.5">
            {[STATUS_ROW1, STATUS_ROW2].map((row, ri) => (
              <div key={ri} className="grid grid-cols-5 gap-1.5">
                {row.map((card) => {
                  const count = statusCounts[card.key] || 0;
                  const isActive = statusFilter === card.key;
                  const isAlert = ALERT_STATUSES.has(card.key) && count > 0;
                  return (
                    <button
                      key={card.key}
                      onClick={() => setStatusFilter(isActive ? null : card.key)}
                      className={`flex items-center justify-between px-3 py-1.5 rounded-md border text-left transition-colors cursor-pointer ${
                        isActive
                          ? "bg-primary/20 border-primary"
                          : isAlert
                            ? "bg-red-950/60 border-red-700 hover:border-red-500 hover:bg-red-900/40 animate-pulse-subtle"
                            : "bg-card border-border hover:border-primary/50 hover:bg-muted/30"
                      }`}
                    >
                      <span className={`text-[11px] whitespace-nowrap ${isAlert ? "text-foreground font-medium" : "text-muted-foreground"}`}>{card.label}</span>
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
                {/* Checkbox column — admin only */}
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

                  // Correction button disabled for non-correctable statuses
                  const correctionDisabled = CORRECTION_DISABLED_STATUSES.includes(derivedStatus);

                  // Operation button label and color
                  let opLabel = "データ補正";
                  let opColorClass = "bg-red-700 hover:bg-red-600 text-white border-0";
                  if (derivedStatus === "レビュー待ち") {
                    opLabel = "レビュー";
                    opColorClass = "bg-purple-700 hover:bg-purple-600 text-white border-0";
                  } else if (derivedStatus === "データ確定") {
                    opLabel = "再補正";
                    opColorClass = "bg-blue-700 hover:bg-blue-600 text-white border-0";
                  }

                  // Role-based: 一般ユーザー cannot use レビュー, 再補正, 再解析
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
                      {/* Checkbox — admin only */}
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
                          {/* Main operation button */}
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
                          {/* Re-analysis button */}
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

      {/* Re-analysis dialog */}
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
