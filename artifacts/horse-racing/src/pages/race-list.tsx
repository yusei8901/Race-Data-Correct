import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Calendar, RefreshCcw, Download } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useUserRole } from "@/contexts/user-role";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = BASE_URL + "/fastapi";

// ── Types ────────────────────────────────────────────────────────────────
interface Venue { code: string; name: string; }
interface RaceItem {
  raceId: number;
  venue: Venue;
  raceNumber: number;
  raceName: string;
  distance: number;
  videoStatus: string;
  videoStatusLabel: string;
  isSelectable: boolean;
  status: string;
  statusLabel: string;
  subStatus: string | null;
  subStatusLabel: string | null;
  latestComment: string | null;
  updatedAt: string | null;
}

// ── Status helpers ───────────────────────────────────────────────────────
function getStatusBadgeClass(status: string, subStatus: string | null): string {
  if (status === "CONFIRMED") return "bg-green-900/40 text-green-400 border-green-800";
  if (status === "ANALYZED") {
    if (subStatus === "EDITING") return "bg-amber-900/50 text-amber-300 border-amber-700";
    if (subStatus === "REVISION_REQUESTED") return "bg-orange-900/50 text-orange-300 border-orange-700";
    return "bg-amber-900/40 text-amber-300 border-amber-700";
  }
  if (status === "IN_REVIEW") return "bg-purple-900/40 text-purple-400 border-purple-700";
  if (status === "NEEDS_ATTENTION") return "bg-red-900/50 text-red-400 border-red-700";
  if (status === "ANALYZING") return "bg-cyan-900/50 text-cyan-300 border-cyan-600";
  if (status === "WAITING") return "bg-cyan-900/40 text-cyan-400 border-cyan-700";
  return "bg-muted text-muted-foreground border-border";
}

function getVideoBadgeClass(videoStatus: string): string {
  if (videoStatus === "LINKED") return "bg-green-900/40 text-green-400 border-green-800";
  return "bg-zinc-800/60 text-zinc-500 border-zinc-700";
}

function getDisplayLabel(status: string, subStatus: string | null, statusLabel: string, subStatusLabel: string | null): string {
  if (subStatusLabel) return subStatusLabel;
  return statusLabel;
}

// ── Tab definitions ──────────────────────────────────────────────────────
interface TabDef {
  key: string;
  label: string;
  activeClass: string;
  matchFn: (r: RaceItem) => boolean;
  subFilters?: { key: string; label: string; matchFn: (r: RaceItem) => boolean }[];
}

const TABS: TabDef[] = [
  { key: "total", label: "総レース", activeClass: "bg-zinc-700/50 border-zinc-500/70 text-zinc-100", matchFn: () => true },
  {
    key: "CONFIRMED", label: "データ確定", activeClass: "bg-green-900/40 border-green-500/70 text-green-300",
    matchFn: (r) => r.status === "CONFIRMED",
  },
  {
    key: "ANALYZED", label: "要補正", activeClass: "bg-amber-900/35 border-amber-500/70 text-amber-200",
    matchFn: (r) => r.status === "ANALYZED",
    subFilters: [
      { key: "EDITING", label: "補正中", matchFn: (r) => r.status === "ANALYZED" && r.subStatus === "EDITING" },
      { key: "REVISION_REQUESTED", label: "修正要請", matchFn: (r) => r.status === "ANALYZED" && r.subStatus === "REVISION_REQUESTED" },
      { key: "ANALYZED_ONLY", label: "補正待ち", matchFn: (r) => r.status === "ANALYZED" && !r.subStatus },
    ],
  },
  {
    key: "WAITING_GROUP", label: "待機中", activeClass: "bg-cyan-900/35 border-cyan-500/70 text-cyan-200",
    matchFn: (r) => r.status === "WAITING" || r.status === "ANALYZING",
    subFilters: [
      { key: "WAITING", label: "解析待ち", matchFn: (r) => r.status === "WAITING" },
      { key: "ANALYZING", label: "解析中", matchFn: (r) => r.status === "ANALYZING" },
    ],
  },
  {
    key: "ADMIN_GROUP", label: "管理者対応", activeClass: "bg-red-900/35 border-red-500/70 text-red-200",
    matchFn: (r) => r.status === "IN_REVIEW" || r.status === "NEEDS_ATTENTION",
    subFilters: [
      { key: "IN_REVIEW", label: "レビュー中", matchFn: (r) => r.status === "IN_REVIEW" },
      { key: "NEEDS_ATTENTION", label: "要対応", matchFn: (r) => r.status === "NEEDS_ATTENTION" },
    ],
  },
];

const BULK_OPTIONS = [
  { label: "データ確定", toStatus: "CONFIRMED", toSubStatus: null },
  { label: "レビュー中", toStatus: "IN_REVIEW", toSubStatus: null },
  { label: "要補正（待機）", toStatus: "ANALYZED", toSubStatus: null },
];

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateTitle(dateStr: string): string {
  try {
    const d = new Date(dateStr.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const wd = WEEKDAYS[d.getDay()];
    return `${y}年${m}月${day}日（${wd}）のレース一覧`;
  } catch { return "レース一覧"; }
}

function downloadCSV(races: RaceItem[], dateStr: string) {
  const header = ["競馬場", "R", "レース名", "距離", "動画", "ステータス", "更新時刻"].join(",");
  const rows = races.map((r) => {
    const updatedTime = r.updatedAt
      ? (() => { try { const d = new Date(r.updatedAt!); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; } catch { return "-"; } })()
      : "-";
    return [
      r.venue.name,
      `${r.raceNumber}R`,
      `"${r.raceName}"`,
      `${r.distance}m`,
      r.videoStatusLabel,
      r.subStatusLabel || r.statusLabel,
      updatedTime,
    ].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `races_${dateStr}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────
export default function RaceList() {
  const { isAdmin } = useUserRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [date, setDate] = useState(format(new Date(), "yyyyMMdd"));
  const [venueFilter, setVenueFilter] = useState<string>("all");
  const [tabFilter, setTabFilter] = useState("total");
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [bulkIdx, setBulkIdx] = useState(0);

  // Format date for API (yyyyMMdd)
  const dateForApi = date;

  const { data, isLoading, refetch } = useQuery<{ items: RaceItem[] }>({
    queryKey: ["races", dateForApi],
    queryFn: async () => {
      const res = await fetch(`${API}/races?date=${dateForApi}`);
      if (!res.ok) throw new Error("Failed to fetch races");
      return res.json();
    },
    enabled: !!dateForApi,
  });

  const allRaces = data?.items ?? [];

  // Venue options from data
  const venueOptions = useMemo(() => {
    const opts = [{ value: "all", label: "すべて" }];
    const seen = new Set<string>();
    allRaces.forEach((r) => {
      if (!seen.has(r.venue.code)) {
        seen.add(r.venue.code);
        opts.push({ value: r.venue.code, label: r.venue.name });
      }
    });
    return opts;
  }, [allRaces]);

  // Venue-filtered races
  const races = useMemo(() => {
    if (venueFilter === "all") return allRaces;
    return allRaces.filter((r) => r.venue.code === venueFilter);
  }, [allRaces, venueFilter]);

  // Tab & sub-filter
  const activeTab = TABS.find((t) => t.key === tabFilter) ?? TABS[0];

  const filteredRaces = useMemo(() => {
    if (tabFilter === "total") return races;
    const byTab = races.filter(activeTab.matchFn);
    if (!subFilter || !activeTab.subFilters) return byTab;
    const sf = activeTab.subFilters.find((s) => s.key === subFilter);
    return sf ? byTab.filter(sf.matchFn) : byTab;
  }, [races, tabFilter, subFilter, activeTab]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { total: races.length };
    TABS.slice(1).forEach((tab) => {
      counts[tab.key] = races.filter(tab.matchFn).length;
      tab.subFilters?.forEach((sf) => {
        counts[`${tab.key}::${sf.key}`] = races.filter(sf.matchFn).length;
      });
    });
    return counts;
  }, [races]);

  // Bulk selection
  const eligibleIds = useMemo(
    () => filteredRaces.filter((r) => r.isSelectable).map((r) => r.raceId),
    [filteredRaces]
  );
  const allChecked = eligibleIds.length > 0 && eligibleIds.every((id) => checkedIds.has(id));
  const someChecked = eligibleIds.some((id) => checkedIds.has(id));

  const toggleAll = () => {
    if (allChecked) setCheckedIds((p) => { const n = new Set(p); eligibleIds.forEach((id) => n.delete(id)); return n; });
    else setCheckedIds((p) => { const n = new Set(p); eligibleIds.forEach((id) => n.add(id)); return n; });
  };
  const toggleRow = (id: number) => setCheckedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedIds = filteredRaces.filter((r) => checkedIds.has(r.raceId) && r.isSelectable).map((r) => r.raceId);

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const opt = BULK_OPTIONS[bulkIdx];
      const res = await fetch(`${API}/races/bulk-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dev-User-Id": "10" },
        body: JSON.stringify({ raceIds: selectedIds, toStatus: opt.toStatus, toSubStatus: opt.toSubStatus }),
      });
      if (!res.ok) throw new Error("Bulk update failed");
      return res.json();
    },
    onSuccess: (result) => {
      setCheckedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["races", dateForApi] });
      toast({ title: `${result.successCount}件を「${BULK_OPTIONS[bulkIdx].label}」に変更しました` });
    },
    onError: () => toast({ title: "一括変更に失敗しました", variant: "destructive" }),
  });

  const handleDateChange = (val: string) => {
    setDate(val.replace(/-/g, ""));
    setVenueFilter("all");
    setCheckedIds(new Set());
    setTabFilter("total");
    setSubFilter(null);
  };

  // Format date for input
  const dateForInput = date.length === 8
    ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`
    : date;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-zinc-950/95 border-b border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold text-foreground">レース一覧</h1>
          <div className="flex items-center gap-2 ml-auto">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              value={dateForInput}
              onChange={(e) => handleDateChange(e.target.value)}
              className="h-8 w-40 text-sm bg-zinc-900 border-zinc-700"
            />
            <Select value={venueFilter} onValueChange={setVenueFilter}>
              <SelectTrigger className="h-8 w-32 text-sm bg-zinc-900 border-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {venueOptions.map((v) => (
                  <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs cursor-pointer"
              onClick={() => refetch()}
            >
              <RefreshCcw className="h-3.5 w-3.5" />更新
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs cursor-pointer"
              onClick={() => downloadCSV(filteredRaces, date)}
            >
              <Download className="h-3.5 w-3.5" />CSV
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {TABS.map((tab) => {
            const isActive = tabFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => { setTabFilter(tab.key); setSubFilter(null); setCheckedIds(new Set()); }}
                className={`px-3 py-1 rounded-md border text-xs font-medium transition-all cursor-pointer ${
                  isActive ? tab.activeClass : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] ${isActive ? "bg-white/15" : "bg-zinc-800"}`}>
                  {tabCounts[tab.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {/* Sub-filters */}
        {activeTab.subFilters && (
          <div className="flex gap-1 mt-1.5">
            <button
              onClick={() => setSubFilter(null)}
              className={`px-2.5 py-0.5 rounded-full border text-[11px] cursor-pointer ${
                !subFilter ? "bg-zinc-700 border-zinc-500 text-white" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}
            >すべて</button>
            {activeTab.subFilters.map((sf) => (
              <button
                key={sf.key}
                onClick={() => setSubFilter(sf.key === subFilter ? null : sf.key)}
                className={`px-2.5 py-0.5 rounded-full border text-[11px] cursor-pointer ${
                  subFilter === sf.key ? "bg-zinc-700 border-zinc-500 text-white" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {sf.label}
                <span className="ml-1 text-[10px] opacity-70">{tabCounts[`${activeTab.key}::${sf.key}`] ?? 0}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Title */}
      <div className="px-4 py-2 text-xs text-muted-foreground">
        {date ? formatDateTitle(date) : "日付を選択してください"} — {filteredRaces.length}件
      </div>

      {/* Bulk controls */}
      {isAdmin && selectedIds.length > 0 && (
        <div className="px-4 pb-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{selectedIds.length}件選択中</span>
          <Select value={String(bulkIdx)} onValueChange={(v) => setBulkIdx(Number(v))}>
            <SelectTrigger className="h-7 w-36 text-xs bg-zinc-900 border-zinc-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BULK_OPTIONS.map((o, i) => (
                <SelectItem key={i} value={String(i)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-7 text-xs cursor-pointer"
            onClick={() => bulkMutation.mutate()}
            disabled={bulkMutation.isPending}
          >
            一括変更
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="px-4 pb-6">
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-900/60 hover:bg-zinc-900/60">
                {isAdmin && (
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={toggleAll}
                      className="cursor-pointer"
                    />
                  </TableHead>
                )}
                <TableHead className="text-xs text-muted-foreground pl-4">R</TableHead>
                <TableHead className="text-xs text-muted-foreground">競馬場</TableHead>
                <TableHead className="text-xs text-muted-foreground">レース名</TableHead>
                <TableHead className="text-xs text-muted-foreground">距離</TableHead>
                <TableHead className="text-xs text-muted-foreground">動画</TableHead>
                <TableHead className="text-xs text-muted-foreground">ステータス</TableHead>
                <TableHead className="text-xs text-muted-foreground">コメント</TableHead>
                <TableHead className="text-xs text-muted-foreground">更新</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-zinc-900/30">
                    {isAdmin && <TableCell />}
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                    <TableCell />
                  </TableRow>
                ))
              ) : filteredRaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 10 : 9} className="text-center text-muted-foreground py-12">
                    対象のレースが見つかりません
                  </TableCell>
                </TableRow>
              ) : (
                filteredRaces.map((race) => {
                  const badgeClass = getStatusBadgeClass(race.status, race.subStatus);
                  const displayLabel = race.subStatusLabel || race.statusLabel;
                  const isChecked = checkedIds.has(race.raceId);
                  const updatedTime = race.updatedAt
                    ? (() => { try { const d = new Date(race.updatedAt!); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; } catch { return "-"; } })()
                    : "-";

                  return (
                    <TableRow
                      key={race.raceId}
                      className={`transition-colors hover:bg-zinc-900/40 ${
                        race.subStatus === "REVISION_REQUESTED" || race.status === "NEEDS_ATTENTION"
                          ? "border-l-2 border-l-red-600"
                          : ""
                      }`}
                    >
                      {isAdmin && (
                        <TableCell className="pl-4">
                          {race.isSelectable && (
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleRow(race.raceId)}
                              className="cursor-pointer"
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell className="pl-4 font-mono text-sm text-foreground">
                        {race.raceNumber}R
                      </TableCell>
                      <TableCell className="text-sm text-foreground">
                        {race.venue.name}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <span className="text-sm text-foreground truncate block">{race.raceName}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {race.distance}m
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${getVideoBadgeClass(race.videoStatus)}`}>
                          {race.videoStatusLabel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${badgeClass}`}>
                          {displayLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[160px]">
                        {race.latestComment && (
                          <span className="text-[11px] text-orange-400 truncate block" title={race.latestComment}>
                            {race.latestComment}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {updatedTime}
                      </TableCell>
                      <TableCell className="pr-4">
                        {race.isSelectable && (
                          <Link href={`/races/${race.raceId}`}>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] cursor-pointer bg-zinc-800 border-zinc-600 hover:bg-zinc-700"
                            >
                              詳細
                            </Button>
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
