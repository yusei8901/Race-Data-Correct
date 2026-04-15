import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Calendar, RefreshCcw, Download, RefreshCw } from "lucide-react";
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
// Now derived from race.display_status (computed server-side from status_code + event)
type DerivedStatus =
  | "解析待機中"
  | "解析中"
  | "解析失敗"
  | "要補正"
  | "補正中"
  | "修正要請"
  | "突合失敗"
  | "レビュー待ち"
  | "管理者対応"
  | "再解析要請"
  | "データ確定";

const KNOWN_STATUSES: ReadonlySet<DerivedStatus> = new Set<DerivedStatus>([
  "解析待機中", "解析中", "解析失敗", "要補正", "補正中",
  "修正要請", "突合失敗", "レビュー待ち", "管理者対応", "再解析要請", "データ確定",
]);

function getDerivedStatus(race: Race): DerivedStatus {
  const ds = race.display_status ?? "";
  if (ds && KNOWN_STATUSES.has(ds as DerivedStatus)) return ds as DerivedStatus;
  // Fallback via new status_code + event
  const sc = race.status_code ?? "";
  const ev = race.event ?? "";
  if (sc === "WAITING")         return "解析待機中";
  if (sc === "ANALYZING")       return "解析中";
  if (sc === "ANALYZED") {
    if (ev === "EDITING")            return "補正中";
    if (ev === "REVISION_REQUESTED") return "修正要請";
    return "要補正";
  }
  if (sc === "IN_REVIEW")       return "レビュー待ち";
  if (sc === "NEEDS_ATTENTION") {
    if (ev === "ANALYSIS_FAILED")    return "解析失敗";
    if (ev === "MATCH_FAILED")       return "突合失敗";
    if (ev === "ANALYSIS_REQUESTED") return "再解析要請";
    return "管理者対応";
  }
  if (sc === "CONFIRMED")       return "データ確定";
  return "解析待機中";
}

function getStatusBadgeProps(status: DerivedStatus) {
  switch (status) {
    // 待機中グループ → cyan（水色）
    case "解析待機中": return { className: "bg-cyan-900/40 text-cyan-400 border-cyan-700",    label: "解析待機中" };
    case "解析中":     return { className: "bg-cyan-900/50 text-cyan-300 border-cyan-600",    label: "解析中" };
    // 要補正グループ → amber
    case "要補正":     return { className: "bg-amber-900/40 text-amber-300 border-amber-700", label: "要補正" };
    case "補正中":     return { className: "bg-amber-900/50 text-amber-300 border-amber-700", label: "補正中" };
    case "修正要請":   return { className: "bg-amber-900/50 text-amber-300 border-amber-700", label: "修正要請" };
    // データ確定グループ → green
    case "データ確定": return { className: "bg-green-900/40 text-green-400 border-green-800", label: "データ確定" };
    // 管理者対応グループ → red（赤）
    case "レビュー待ち": return { className: "bg-red-900/40 text-red-400 border-red-700",    label: "レビュー待ち" };
    case "解析失敗":   return { className: "bg-red-900/50 text-red-400 border-red-700",       label: "解析失敗" };
    case "突合失敗":   return { className: "bg-red-900/50 text-red-400 border-red-700",       label: "突合失敗" };
    case "再解析要請": return { className: "bg-red-900/50 text-red-400 border-red-700",       label: "再解析要請" };
    case "管理者対応": return { className: "bg-red-900/30 text-red-400 border-red-800",       label: "管理者対応" };
    default:           return { className: "bg-muted text-muted-foreground border-muted-border", label: status };
  }
}

// ステータス列: status_codeベースのバッジ色（タブ色と統一）
function getStatusCodeBadgeClass(statusCode: string | null | undefined): string {
  switch (statusCode) {
    case "WAITING":         return "bg-cyan-900/40 text-cyan-400 border-cyan-700";
    case "ANALYZING":       return "bg-cyan-900/50 text-cyan-300 border-cyan-600";
    case "ANALYZED":        return "bg-amber-900/40 text-amber-300 border-amber-700";
    case "IN_REVIEW":       return "bg-red-900/40 text-red-400 border-red-700";
    case "NEEDS_ATTENTION": return "bg-red-900/50 text-red-400 border-red-700";
    case "CONFIRMED":       return "bg-green-900/40 text-green-400 border-green-800";
    default:                return "bg-muted text-muted-foreground border-border";
  }
}

// Selectable statuses for bulk update (tab_group is "要補正" or "管理者対応待ち" or "データ確定")
const SELECTABLE_STATUS_CODES = new Set(["ANALYZED", "IN_REVIEW", "NEEDS_ATTENTION", "CONFIRMED"]);

interface BulkStatusOption {
  label: string;
  status_code: string;
  event: string | null;
}

const BULK_STATUS_OPTIONS: BulkStatusOption[] = [
  { label: "データ確定",         status_code: "CONFIRMED", event: null },
  { label: "レビュー待ち",     status_code: "IN_REVIEW", event: null },
  { label: "要補正（待機）", status_code: "ANALYZED",  event: null },
  { label: "解析待機中",     status_code: "WAITING",   event: null },
];

function isSelectable(race: Race): boolean {
  return SELECTABLE_STATUS_CODES.has(race.status_code ?? "");
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

function formatGoalTimeDisplay(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function parseGoalTimeInput(s: string): number | null {
  const s1 = s.trim();
  if (!s1) return null;
  const m1 = s1.match(/^(\d+):(\d{2})\.(\d{1,2})$/);
  if (m1) {
    const cs = m1[3].length === 1 ? parseInt(m1[3]) * 10 : parseInt(m1[3]);
    return parseInt(m1[1]) * 60 + parseInt(m1[2]) + cs / 100;
  }
  const m2 = s1.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (m2) return parseInt(m2[1]) * 60 + parseInt(m2[2]) + parseInt(m2[3]) / 100;
  const m3 = s1.match(/^(\d+):(\d{2})$/);
  if (m3) return parseInt(m3[1]) * 60 + parseInt(m3[2]);
  const n = parseFloat(s1);
  return isNaN(n) ? null : n;
}

interface VenuePreset {
  id: string;
  name: string;
  venue_code: string;
  surface_type: string;
  is_active: boolean;
}

function getVideoBadgeProps(displayStatus: string | null | undefined) {
  switch (displayStatus) {
    case "連携済み": return { className: "bg-green-900/40 text-green-400 border-green-800", label: "連携済み" };
    case "未連携":   return { className: "bg-zinc-800/60 text-zinc-500 border-zinc-700",   label: "未連携" };
    default:         return { className: "bg-zinc-800/60 text-zinc-500 border-zinc-700",   label: displayStatus || "-" };
  }
}

const ALERT_STATUSES: Set<string> = new Set(["修正要請", "解析失敗", "再解析要請", "突合失敗"]);
const HIGHLIGHT_STATUSES: Set<string> = new Set([...ALERT_STATUSES, "解析待機中"]);

const ALERT_STYLE_MAP: Record<string, { bg: string; border: string; hoverBorder: string; hoverBg: string; shadow: string; textColor: string }> = {
  "修正要請":   { bg: "bg-orange-950/80", border: "border-orange-500", hoverBorder: "hover:border-orange-300", hoverBg: "hover:bg-orange-900/60", shadow: "shadow-[0_0_10px_rgba(249,115,22,0.45)]", textColor: "text-orange-200" },
  "解析失敗":   { bg: "bg-red-950/80",    border: "border-red-500",    hoverBorder: "hover:border-red-300",    hoverBg: "hover:bg-red-900/60",    shadow: "shadow-[0_0_10px_rgba(239,68,68,0.45)]",  textColor: "text-red-200" },
  "再解析要請": { bg: "bg-red-950/80",    border: "border-red-500",    hoverBorder: "hover:border-red-300",    hoverBg: "hover:bg-red-900/60",    shadow: "shadow-[0_0_10px_rgba(239,68,68,0.45)]",  textColor: "text-red-200" },
  "突合失敗":   { bg: "bg-red-950/80",    border: "border-red-600",    hoverBorder: "hover:border-red-400",    hoverBg: "hover:bg-red-900/60",    shadow: "shadow-[0_0_10px_rgba(239,68,68,0.45)]",  textColor: "text-red-200" },
};

type FilterKey = string;

// 2-tier tab+filter system
interface TabDef {
  key: FilterKey;
  label: string;
  colorClass: string;
  activeClass: string;
  badgeActiveClass: string;
  matchFn: (race: Race) => boolean;
  subFilters?: SubFilterDef[];
}

interface SubFilterDef {
  key: string;
  label: string;
  colorClass: string;
  activeClass: string;
  matchFn: (race: Race) => boolean;
}

const TABS: TabDef[] = [
  {
    key: "total",
    label: "総レース",
    colorClass: "text-zinc-300",
    activeClass: "bg-zinc-700/50 border-zinc-500/70 text-zinc-100 shadow-[0_0_10px_rgba(161,161,170,0.25)]",
    badgeActiveClass: "bg-zinc-500/50 text-zinc-100",
    matchFn: () => true,
  },
  {
    key: "データ確定",
    label: "データ確定",
    colorClass: "text-green-400",
    activeClass: "bg-green-900/40 border-green-500/70 text-green-300 shadow-[0_0_10px_rgba(74,222,128,0.3)]",
    badgeActiveClass: "bg-green-600/50 text-green-100",
    matchFn: (r) => r.status_code === "CONFIRMED",
  },
  {
    key: "要補正",
    label: "要補正",
    colorClass: "text-amber-300",
    activeClass: "bg-amber-900/35 border-amber-500/70 text-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.3)]",
    badgeActiveClass: "bg-amber-600/50 text-amber-100",
    matchFn: (r) => r.status_code === "ANALYZED",
    subFilters: [
      { key: "補正中",    label: "補正中",   colorClass: "text-amber-300", activeClass: "bg-amber-900/50 border-amber-500/70 text-amber-200", matchFn: (r) => r.status_code === "ANALYZED" && r.event === "EDITING" },
      { key: "修正要請",  label: "修正要請", colorClass: "text-amber-300", activeClass: "bg-amber-900/50 border-amber-500/70 text-amber-200", matchFn: (r) => r.status_code === "ANALYZED" && r.event === "REVISION_REQUESTED" },
      { key: "要補正のみ", label: "補正待ち", colorClass: "text-amber-300", activeClass: "bg-amber-900/50 border-amber-500/70 text-amber-200", matchFn: (r) => r.status_code === "ANALYZED" && !r.event },
    ],
  },
  {
    key: "待機中",
    label: "待機中",
    colorClass: "text-cyan-400",
    activeClass: "bg-cyan-900/35 border-cyan-500/70 text-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.25)]",
    badgeActiveClass: "bg-cyan-600/50 text-cyan-100",
    matchFn: (r) => r.tab_group === "待機中",
    subFilters: [
      { key: "解析待機中", label: "解析待機中", colorClass: "text-cyan-400", activeClass: "bg-cyan-900/50 border-cyan-500/70 text-cyan-200", matchFn: (r) => r.status_code === "WAITING" },
      { key: "解析中",    label: "解析中",    colorClass: "text-cyan-400",  activeClass: "bg-cyan-900/50 border-cyan-500/70 text-cyan-200",  matchFn: (r) => r.status_code === "ANALYZING" },
    ],
  },
  {
    key: "管理者対応待ち",
    label: "管理者対応",
    colorClass: "text-red-400",
    activeClass: "bg-red-900/35 border-red-500/70 text-red-200 shadow-[0_0_12px_rgba(239,68,68,0.35)]",
    badgeActiveClass: "bg-red-600/50 text-red-100",
    matchFn: (r) => r.tab_group === "管理者対応待ち",
    subFilters: [
      { key: "レビュー待ち", label: "レビュー待ち", colorClass: "text-red-400", activeClass: "bg-red-900/50 border-red-500/70 text-red-200", matchFn: (r) => r.status_code === "IN_REVIEW" },
      { key: "解析失敗",    label: "解析失敗",    colorClass: "text-red-400",   activeClass: "bg-red-900/50 border-red-500/70 text-red-200", matchFn: (r) => r.event === "ANALYSIS_FAILED" },
      { key: "突合失敗",    label: "突合失敗",    colorClass: "text-red-400",   activeClass: "bg-red-900/50 border-red-500/70 text-red-200", matchFn: (r) => r.event === "MATCH_FAILED" },
      { key: "再解析要請",  label: "再解析要請",  colorClass: "text-red-400",   activeClass: "bg-red-900/50 border-red-500/70 text-red-200", matchFn: (r) => r.event === "ANALYSIS_REQUESTED" },
    ],
  },
];


function getEventLabel(event: string | null | undefined): string {
  if (!event) return "-";
  switch (event) {
    case "EDITING":            return "補正中";
    case "REVISION_REQUESTED": return "修正要請";
    case "ANALYSIS_FAILED":    return "解析失敗";
    case "MATCH_FAILED":       return "突合失敗";
    case "ANALYSIS_REQUESTED": return "再解析要請";
    default: return event;
  }
}

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
    case "要補正":
    case "補正中":
    case "修正要請":
      return { label: "レース詳細", colorClass: "bg-orange-700 hover:bg-orange-600 text-white border-0", disabled: false, adminOnly: false };
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
      r.video_raw_status === "LINKED" ? "連携済み" : "未連携",
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
    return JSON.parse(raw) as { date?: string; venue?: string; raceType?: string; statusFilter?: string };
  } catch { return null; }
}

export default function RaceList() {
  const { isAdmin } = useUserRole();
  const { toast } = useToast();

  const saved = getSavedState();
  const [date, setDate] = useState(saved?.date ?? "");
  const [venue, setVenue] = useState<string>(saved?.venue ?? "all");
  const [raceType, setRaceType] = useState<string>(saved?.raceType ?? "中央競馬");
  const [tabFilter, setTabFilter] = useState<string>(saved?.statusFilter ?? "total");
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkStatusIdx, setBulkStatusIdx] = useState<number>(0);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const [presets, setPresets] = useState<VenuePreset[]>([]);
  const [editingGoalTime, setEditingGoalTime] = useState<{ raceId: string; value: string } | null>(null);
  const [savingOptionIds, setSavingOptionIds] = useState<Set<string>>(new Set());
  const goalTimeInputRef = useRef<HTMLInputElement>(null);

  type PendingChange = {
    race: Race;
    type: "goalTime" | "preset";
    fieldLabel: string;
    fromLabel: string;
    toLabel: string;
    save: () => Promise<void>;
  };
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [pendingPresetDisplay, setPendingPresetDisplay] = useState<{ raceId: string; value: string } | null>(null);

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
    sessionStorage.setItem(RACE_LIST_STATE_KEY, JSON.stringify({ date, venue, raceType, statusFilter: tabFilter }));
  }, [date, venue, raceType, tabFilter]);

  useEffect(() => {
    fetch(`${API}/venue-weather-presets?active_only=true`)
      .then((r) => r.json())
      .then((data) => setPresets(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

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
    setTabFilter("total");
    setSubFilter(null);
  };


  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { total: races.length };
    TABS.slice(1).forEach((tab) => {
      counts[tab.key] = races.filter(tab.matchFn).length;
      if (tab.subFilters) {
        tab.subFilters.forEach((sf) => {
          counts[`${tab.key}::${sf.key}`] = races.filter(sf.matchFn).length;
        });
      }
    });
    return counts;
  }, [races]);

  const activeTab = useMemo(() => TABS.find((t) => t.key === tabFilter) ?? TABS[0], [tabFilter]);

  const filteredRaces = useMemo(() => {
    if (tabFilter === "total" || !tabFilter) return races;
    const tab = activeTab;
    if (!tab) return races;
    const byTab = races.filter(tab.matchFn);
    if (!subFilter || !tab.subFilters) return byTab;
    const sf = tab.subFilters.find((s) => s.key === subFilter);
    return sf ? byTab.filter(sf.matchFn) : byTab;
  }, [races, tabFilter, subFilter, activeTab]);

  const eligibleIds = useMemo(
    () => filteredRaces.filter((r) => isSelectable(r)).map((r) => r.id),
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
    .filter((r) => checkedIds.has(r.id) && isSelectable(r))
    .map((r) => r.id);

  const batchUpdateMutation = useBatchUpdateRaces();

  const handleBulkUpdate = () => {
    if (selectedIds.length === 0) return;
    setBulkConfirmOpen(true);
  };

  const bulkOption = BULK_STATUS_OPTIONS[bulkStatusIdx] ?? BULK_STATUS_OPTIONS[0];

  const executeBulkUpdate = () => {
    setBulkConfirmOpen(false);
    batchUpdateMutation.mutate(
      { data: { race_ids: selectedIds, status_code: bulkOption.status_code, event: bulkOption.event ?? undefined } },
      {
        onSuccess: () => {
          setCheckedIds(new Set());
          queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey(queryParams) });
          toast({ title: `${selectedIds.length}件のレースを「${bulkOption.label}」に変更しました` });
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
        currentStatus: r.display_status ?? getDerivedStatus(r),
      }));
  }, [bulkConfirmOpen, filteredRaces, selectedIds]);


  const saveAnalysisOption = async (
    race: Race,
    overrides: { goalTimeSec?: number | null; presetId?: string | null }
  ) => {
    const raceId = race.id;
    setSavingOptionIds((prev) => new Set(prev).add(raceId));
    const body: Record<string, unknown> = {};
    const gt = "goalTimeSec" in overrides ? overrides.goalTimeSec : race.video_goal_time_raw;
    const pid = "presetId" in overrides ? overrides.presetId : race.preset_id;
    if (gt != null) body.video_goal_time = gt;
    if (pid) body.venue_weather_preset_id = pid;
    try {
      const res = await fetch(`${API}/races/${raceId}/analysis-option`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey(queryParams) });
      } else {
        toast({ title: "保存に失敗しました", variant: "destructive" });
      }
    } catch {
      toast({ title: "通信エラーが発生しました", variant: "destructive" });
    }
    setSavingOptionIds((prev) => { const s = new Set(prev); s.delete(raceId); return s; });
  };

  const handleGoalTimeEditStart = (race: Race) => {
    const val = race.video_goal_time_raw != null ? formatGoalTimeDisplay(race.video_goal_time_raw) : "";
    setEditingGoalTime({ raceId: race.id, value: val });
  };

  const handleGoalTimeCommit = (race: Race) => {
    if (!editingGoalTime || editingGoalTime.raceId !== race.id) return;
    const raw = editingGoalTime.value.trim();
    setEditingGoalTime(null);
    const parsed = raw === "" ? null : parseGoalTimeInput(raw);
    if (raw !== "" && parsed === null) {
      toast({ title: "無効な時刻形式です（例: 1:30.05）", variant: "destructive" });
      return;
    }
    const fromLabel = race.video_goal_time_raw != null ? formatGoalTimeDisplay(race.video_goal_time_raw) : "（未設定）";
    const toLabel = parsed != null ? formatGoalTimeDisplay(parsed) : "（クリア）";
    if (fromLabel === toLabel) return;
    setPendingChange({
      race,
      type: "goalTime",
      fieldLabel: "ゴールタイム",
      fromLabel,
      toLabel,
      save: () => saveAnalysisOption(race, { goalTimeSec: parsed }),
    });
  };

  const handlePresetChange = (race: Race, newPresetId: string) => {
    const fromPreset = presets.find((p) => p.id === (race.preset_id || ""));
    const toPreset = presets.find((p) => p.id === newPresetId);
    const fromLabel = fromPreset?.name ?? "（未選択）";
    const toLabel = toPreset?.name ?? "（未選択）";
    if (newPresetId === (race.preset_id || "")) return;
    setPendingPresetDisplay({ raceId: race.id, value: newPresetId });
    setPendingChange({
      race,
      type: "preset",
      fieldLabel: "解析プリセット",
      fromLabel,
      toLabel,
      save: () => saveAnalysisOption(race, { presetId: newPresetId || null }),
    });
  };

  const cancelPendingChange = () => {
    setPendingChange(null);
    setPendingPresetDisplay(null);
  };

  const confirmPendingChange = async () => {
    if (!pendingChange) return;
    const { save } = pendingChange;
    setPendingChange(null);
    setPendingPresetDisplay(null);
    await save();
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

  const totalCount = tabCounts["total"] || 0;

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

      {/* Status filter — 5-tab system */}
      <div className="px-6 pt-3 pb-0">
        {/* Tab row */}
        <div className="flex gap-1.5 border-b border-zinc-800 pb-2">
          {TABS.map((tab) => {
            const count = tabCounts[tab.key] ?? 0;
            const isActive = tabFilter === tab.key;
            const hasOrangeDot = (tab.key === "管理者対応待ち" || tab.key === "要補正") && count > 0;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setTabFilter(tab.key);
                  setSubFilter(null);
                  setCheckedIds(new Set());
                }}
                className={`relative flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-semibold border transition-all duration-150 cursor-pointer whitespace-nowrap ${
                  isActive
                    ? tab.activeClass
                    : `border-zinc-700/50 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 hover:border-zinc-600 ${hasOrangeDot ? "border-orange-800/60 text-orange-500/70" : ""}`
                }`}
              >
                {hasOrangeDot && !isActive && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.8)]" />
                )}
                <span>{tab.label}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none min-w-[18px] text-center transition-all ${
                  isActive
                    ? tab.badgeActiveClass
                    : hasOrangeDot
                      ? "bg-orange-900/60 text-orange-300"
                      : "bg-zinc-800 text-zinc-500"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        {/* Sub-filter row */}
        {activeTab.subFilters && (
          <div className="flex gap-1.5 py-2 flex-wrap items-center">
            <span className="text-[10px] text-zinc-600 mr-0.5 tracking-wide">絞込：</span>
            <button
              onClick={() => setSubFilter(null)}
              className={`px-3 py-1 rounded-md text-[11px] font-medium border cursor-pointer transition-all ${
                !subFilter
                  ? activeTab.activeClass
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              すべて <span className="font-bold ml-1">{tabCounts[activeTab.key] ?? 0}</span>
            </button>
            {activeTab.subFilters.map((sf) => {
              const sfKey = `${activeTab.key}::${sf.key}`;
              const sfCount = tabCounts[sfKey] ?? 0;
              const hasCount = sfCount > 0;
              const isActiveSf = subFilter === sf.key;
              return (
                <button
                  key={sf.key}
                  onClick={() => setSubFilter(subFilter === sf.key ? null : sf.key)}
                  className={`relative px-3 py-1 rounded-md text-[11px] font-medium border cursor-pointer transition-all flex items-center gap-1.5 ${
                    isActiveSf
                      ? sf.activeClass
                      : hasCount
                        ? `border-zinc-600 bg-zinc-800/60 ${sf.colorClass} hover:bg-zinc-700/60`
                        : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {/* 件数があれば右上にアラートドット */}
                  {hasCount && !isActiveSf && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-current opacity-80 shadow-[0_0_4px_currentColor]" />
                  )}
                  <span>{sf.label}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none min-w-[18px] text-center ${
                    isActiveSf
                      ? "bg-white/15 text-white"
                      : hasCount
                        ? "bg-zinc-700/80 text-zinc-200"
                        : "bg-zinc-800 text-zinc-600"
                  }`}>
                    {sfCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk action bar — race status */}
      {isAdmin && selectedIds.length > 0 && (
        <div className="mx-6 mb-1 flex items-center gap-3 bg-primary/10 border border-primary/30 rounded-md px-4 py-2">
          <span className="text-xs text-muted-foreground font-medium">レース {selectedIds.length}件選択中</span>
          <Select value={String(bulkStatusIdx)} onValueChange={(v) => setBulkStatusIdx(Number(v))}>
            <SelectTrigger className="w-[160px] h-7 text-xs cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BULK_STATUS_OPTIONS.map((opt, i) => (
                <SelectItem key={opt.status_code + (opt.event ?? "")} value={String(i)}>{opt.label}</SelectItem>
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

      {/* Table */}
      <div className="flex-1 px-6 pb-6 overflow-hidden flex flex-col min-h-0">
        <div className="rounded-md border border-border bg-card flex-1 overflow-auto">
          <Table className="w-full table-fixed">
            <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur">
              <TableRow>
                <TableHead style={{ width: "5%" }} className="text-center text-xs">競馬場</TableHead>
                <TableHead style={{ width: "4%" }} className="text-center text-xs">R</TableHead>
                <TableHead style={{ width: "10%" }} className="text-left text-xs">レース名</TableHead>
                <TableHead style={{ width: "6%" }} className="text-center text-xs">コース</TableHead>
                <TableHead style={{ width: "5%" }} className="text-center text-xs">距離</TableHead>
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
                <TableHead style={{ width: "9%" }} className="text-xs">ステータス</TableHead>
                <TableHead style={{ width: "8%" }} className="text-xs">詳細</TableHead>
                <TableHead style={{ width: "18%" }} className="text-xs">内容</TableHead>
                <TableHead style={{ width: "5%" }} className="text-xs">担当者</TableHead>
                <TableHead style={{ width: "4%" }} className="text-xs">更新</TableHead>
                <TableHead style={{ width: isAdmin ? "16%" : "21%" }} className="text-center text-xs">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isRacesLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: isAdmin ? 13 : 12 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredRaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 13 : 12} className="h-32 text-center text-muted-foreground text-sm">
                    該当するレースが見つかりません
                  </TableCell>
                </TableRow>
              ) : (
                filteredRaces.map((race) => {
                  const derivedStatus = getDerivedStatus(race);
                  const badgeProps = getStatusBadgeProps(derivedStatus);
                  const videoBadge = getVideoBadgeProps(race.video_display_status);
                  const canSelect = isSelectable(race);
                  const isChecked = checkedIds.has(race.id);
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
                      <TableCell className="text-xs font-medium text-foreground truncate px-2 text-left" title={race.race_name}>
                        {race.race_name || "-"}
                      </TableCell>
                      <TableCell className="text-xs text-center text-muted-foreground">{getCourse(race)}</TableCell>
                      <TableCell className="text-xs text-center text-muted-foreground">{race.distance}m</TableCell>
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
                        <Badge variant="outline" className={`text-[10px] font-normal border ${getStatusCodeBadgeClass(race.status_code)} w-fit whitespace-nowrap`}>
                          {race.display_name || badgeProps.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-white whitespace-nowrap">
                        {getEventLabel(race.event)}
                      </TableCell>
                      <TableCell className="text-xs max-w-[180px] py-1.5">
                        {race.detail ? (
                          <div className="relative group/detail">
                            <span className="block text-white leading-snug line-clamp-2 cursor-default">
                              {race.detail}
                            </span>
                            <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover/detail:block bg-zinc-800 border border-zinc-600 rounded-md p-2.5 text-xs text-white shadow-xl w-[320px] whitespace-normal leading-relaxed pointer-events-none">
                              {race.detail}
                            </div>
                          </div>
                        ) : (
                          <span className="text-zinc-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate">{race.assigned_user || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{updatedTime}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-center">
                          {/* CONFIRMED: 管理者のみ編集導線を表示 */}
                          {derivedStatus === "データ確定" && !isAdmin ? null : opBlocked ? (
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
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${getStatusBadgeProps(item.currentStatus as DerivedStatus).className}`}>
                      {item.currentStatus}
                    </span>
                    <span className="text-zinc-500 text-[10px]">→</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${getStatusBadgeProps(bulkOption.label as DerivedStatus).className}`}>
                      {bulkOption.label}
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

      {pendingChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[400px] max-w-[95vw] p-5">
            <h2 className="text-sm font-semibold mb-2">設定を変更しますか？</h2>
            <p className="text-[11px] text-zinc-400 mb-3">
              <span className="text-zinc-200">{pendingChange.race.venue} {pendingChange.race.race_number}R</span> の
              <span className="text-primary font-medium ml-1">{pendingChange.fieldLabel}</span> を変更します。
            </p>
            <div className="flex items-center justify-center gap-3 bg-zinc-800/60 border border-zinc-700 rounded px-3 py-2.5 mb-4">
              <span className="text-[11px] text-zinc-400 max-w-[40%] text-right break-all leading-snug">{pendingChange.fromLabel}</span>
              <span className="text-zinc-500 text-xs flex-shrink-0">→</span>
              <span className="text-[11px] text-primary font-medium max-w-[40%] break-all leading-snug">{pendingChange.toLabel}</span>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={cancelPendingChange} className="h-8 text-xs cursor-pointer">
                キャンセル
              </Button>
              <Button size="sm" onClick={confirmPendingChange} className="h-8 text-xs cursor-pointer bg-primary hover:bg-primary/90">
                変更する
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
