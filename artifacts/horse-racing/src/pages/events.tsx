import { useState, useEffect, useMemo } from "react";
import {
  CalendarDays, Plus, ChevronRight, Download, RefreshCw,
  Flag, Loader2, X, ExternalLink, FileDown, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE_URL}/fastapi`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  code: string;
  name: string;
}

interface RaceEvent {
  id: string;
  category_id: string;
  category_name: string;
  event_date: string;
  venue_code: string;
  venue_name: string;
  round: number;
  race_count: number;
}

interface EventRace {
  id: string;
  race_number: number;
  race_name: string;
  surface_type: string;
  distance: number;
  direction: string | null;
  start_time: string | null;
  status: string;
}

interface ExportJob {
  job_id: string;
  status: string;
  dataset: string;
  race_count: number;
  created_at: string;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_DISPLAY_MAP: Record<string, string> = {
  PENDING: "未処理",
  ANALYZING: "解析中",
  ANALYSIS_FAILED: "解析失敗",
  ANALYZED: "待機中",
  MATCH_FAILED: "突合失敗",
  CORRECTING: "補正中",
  CORRECTED: "レビュー待ち",
  REVISION_REQUESTED: "修正要請",
  CONFIRMED: "データ確定",
  ANALYSIS_REQUESTED: "再解析要請",
};

const STATUS_COLOR_MAP: Record<string, string> = {
  未処理: "bg-zinc-800 text-zinc-400 border-zinc-700",
  解析中: "bg-cyan-900/30 text-cyan-400 border-cyan-800",
  待機中: "bg-cyan-900/30 text-cyan-400 border-cyan-800",
  補正中: "bg-cyan-900/30 text-cyan-400 border-cyan-800",
  "レビュー待ち": "bg-purple-900/30 text-purple-400 border-purple-800",
  修正要請: "bg-orange-900/30 text-orange-400 border-orange-800",
  データ確定: "bg-green-900/30 text-green-400 border-green-800",
  再解析要請: "bg-red-900/30 text-red-400 border-red-800",
  解析失敗: "bg-red-900/30 text-red-400 border-red-800",
  突合失敗: "bg-red-900/30 text-red-400 border-red-800",
};

function getStatusLabel(raw: string) {
  return STATUS_DISPLAY_MAP[raw] || raw;
}
function getStatusColor(label: string) {
  return STATUS_COLOR_MAP[label] || "bg-zinc-800 text-zinc-400 border-zinc-700";
}

// ── Create Event Dialog ────────────────────────────────────────────────────────

interface CreateEventDialogProps {
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
}

function CreateEventDialog({ categories, onClose, onCreated }: CreateEventDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    category_id: categories[0]?.id || "",
    event_date: "",
    venue_code: "",
    venue_name: "",
    round: "1",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.event_date || !form.venue_code || !form.venue_name) {
      toast({ title: "必須項目を入力してください", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, round: parseInt(form.round, 10) }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "開催を登録しました" });
      onCreated();
      onClose();
    } catch (e) {
      toast({ title: "登録に失敗しました", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[480px] max-w-[95vw] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">開催を新規登録</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-400 block mb-1">カテゴリ</label>
            <Select value={form.category_id} onValueChange={(v) => setForm((f) => ({ ...f, category_id: v }))}>
              <SelectTrigger className="h-8 text-xs bg-zinc-800 border-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">開催日</label>
            <Input
              type="date"
              value={form.event_date}
              onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))}
              className="h-8 text-xs bg-zinc-800 border-zinc-700"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">競馬場コード</label>
              <Input
                value={form.venue_code}
                onChange={(e) => setForm((f) => ({ ...f, venue_code: e.target.value }))}
                placeholder="例: JPN_TOKYO"
                className="h-8 text-xs bg-zinc-800 border-zinc-700"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">競馬場名</label>
              <Input
                value={form.venue_name}
                onChange={(e) => setForm((f) => ({ ...f, venue_name: e.target.value }))}
                placeholder="例: 東京"
                className="h-8 text-xs bg-zinc-800 border-zinc-700"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">回数</label>
            <Input
              type="number"
              min="1"
              value={form.round}
              onChange={(e) => setForm((f) => ({ ...f, round: e.target.value }))}
              className="h-8 text-xs bg-zinc-800 border-zinc-700 w-24"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-5">
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs cursor-pointer">
            キャンセル
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 text-xs cursor-pointer bg-primary hover:bg-primary/90">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "登録する"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Event Detail Panel ────────────────────────────────────────────────────────

interface EventDetailPanelProps {
  event: RaceEvent;
  onClose: () => void;
}

function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
  const { toast } = useToast();
  const [_, navigate] = useLocation();
  const [races, setRaces] = useState<EventRace[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [dataset, setDataset] = useState("all");

  useEffect(() => {
    fetch(`${API}/events/${event.id}/races`)
      .then((r) => r.json())
      .then(setRaces)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [event.id]);

  const handleExportSync = async () => {
    try {
      const res = await fetch(`${API}/events/${event.id}/export/csv?dataset=${dataset}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `event_${event.event_date}_${event.venue_name}_${dataset}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "CSV をダウンロードしました" });
    } catch {
      toast({ title: "CSV 出力に失敗しました", variant: "destructive" });
    }
  };

  const handleExportAsync = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${API}/events/${event.id}/export/csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset }),
      });
      if (!res.ok) throw new Error();
      const job = await res.json();
      setExportJob(job);
      toast({ title: "エクスポートジョブを登録しました" });
    } catch {
      toast({ title: "ジョブ登録に失敗しました", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full border-l border-zinc-800 bg-zinc-950 w-[420px] flex-shrink-0">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{event.venue_name} {event.round}回</div>
          <div className="text-xs text-zinc-500">{event.event_date} / {event.category_name}</div>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 cursor-pointer">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Export section */}
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="text-xs font-medium text-zinc-400 mb-2">CSV 出力</div>
        <div className="flex items-center gap-2 mb-2">
          <Select value={dataset} onValueChange={setDataset}>
            <SelectTrigger className="h-7 text-xs bg-zinc-800 border-zinc-700 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="passing_points" className="text-xs">通過地点（200m）</SelectItem>
              <SelectItem value="straight_sections" className="text-xs">直線区間（50m）</SelectItem>
              <SelectItem value="all" className="text-xs">すべて</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={handleExportSync}
            className="h-7 text-xs cursor-pointer gap-1 border-zinc-700">
            <Download className="h-3 w-3" />同期DL
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportAsync} disabled={exporting}
            className="h-7 text-xs cursor-pointer gap-1 border-zinc-700">
            {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />}
            非同期
          </Button>
        </div>
        {exportJob && (
          <div className="rounded bg-zinc-800/60 border border-zinc-700 px-3 py-2 text-xs space-y-0.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-green-400" />
              <span className="text-zinc-300">ジョブ登録完了</span>
            </div>
            <div className="text-zinc-500">ID: {exportJob.job_id.slice(0, 8)}... / {exportJob.dataset} / {exportJob.race_count}R</div>
          </div>
        )}
      </div>

      {/* Race list */}
      <div className="flex-1 overflow-auto px-4 py-3">
        <div className="text-xs font-medium text-zinc-400 mb-2">
          レース一覧 ({races.length}R)
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
          </div>
        ) : races.length === 0 ? (
          <div className="text-xs text-zinc-600 text-center py-8">レースが登録されていません</div>
        ) : (
          <div className="space-y-1">
            {races.map((race) => {
              const label = getStatusLabel(race.status);
              const color = getStatusColor(label);
              return (
                <div key={race.id}
                  className="flex items-center justify-between rounded bg-zinc-900 border border-zinc-800 px-3 py-2 hover:border-zinc-600 cursor-pointer group"
                  onClick={() => navigate(`/races/${race.id}`)}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-zinc-400 w-8 flex-shrink-0">{race.race_number}R</span>
                    <span className="text-xs text-zinc-200 truncate">{race.race_name}</span>
                    <span className="text-[10px] text-zinc-500 flex-shrink-0">
                      {race.surface_type} {race.distance}m
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${color}`}>{label}</span>
                    <ExternalLink className="h-3 w-3 text-zinc-600 group-hover:text-zinc-300" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Events Page ──────────────────────────────────────────────────────────

export default function EventsManagement() {
  const { toast } = useToast();
  const [events, setEvents] = useState<RaceEvent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<RaceEvent | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetch(`${API}/categories`)
      .then((r) => r.json())
      .then(setCategories)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (categoryFilter !== "all") params.set("category_id", categoryFilter);
    fetch(`${API}/events?${params}`)
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => toast({ title: "開催一覧の取得に失敗しました", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [categoryFilter, refreshKey]);

  const filteredEvents = useMemo(() => {
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter(
      (e) =>
        e.venue_name.toLowerCase().includes(q) ||
        e.event_date.includes(q) ||
        e.category_name?.toLowerCase().includes(q)
    );
  }, [events, search]);

  return (
    <div className="flex h-full bg-background">
      {/* Left — event list */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <h1 className="text-sm font-semibold">開催管理</h1>
            {!loading && (
              <Badge variant="outline" className="text-xs font-mono text-zinc-400 border-zinc-700">
                {filteredEvents.length}件
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="競馬場・日付で検索..."
              className="h-8 text-xs bg-zinc-800/60 border-zinc-700 w-52"
            />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 text-xs bg-zinc-800/60 border-zinc-700 w-36">
                <SelectValue placeholder="カテゴリ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">すべてのカテゴリ</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}
              className="h-8 text-xs cursor-pointer border-zinc-700 gap-1">
              <RefreshCw className="h-3 w-3" />更新
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}
              className="h-8 text-xs cursor-pointer bg-primary hover:bg-primary/90 gap-1">
              <Plus className="h-3 w-3" />開催を登録
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
              <CalendarDays className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">開催が見つかりません</p>
              <p className="text-xs mt-1">「開催を登録」で新しい開催を追加できます</p>
            </div>
          ) : (
            <div className="space-y-2 max-w-4xl">
              {filteredEvents.map((event) => {
                const isSelected = selectedEvent?.id === event.id;
                return (
                  <div key={event.id}
                    onClick={() => setSelectedEvent(isSelected ? null : event)}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                      isSelected
                        ? "border-primary/60 bg-primary/10"
                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-600 hover:bg-zinc-800/60"
                    }`}>
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex-shrink-0">
                        <Flag className="h-4 w-4 text-primary/60" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{event.venue_name}</span>
                          <span className="text-xs text-zinc-500">{event.round}回</span>
                          {event.category_name && (
                            <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400 px-1.5 py-0">
                              {event.category_name}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">{event.event_date}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-xs font-mono text-zinc-300">{event.race_count}R</div>
                        <div className="text-[10px] text-zinc-600">レース</div>
                      </div>
                      <ChevronRight className={`h-4 w-4 text-zinc-600 transition-transform ${isSelected ? "rotate-90" : ""}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right — event detail panel */}
      {selectedEvent && (
        <EventDetailPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}

      {/* Create dialog */}
      {showCreate && (
        <CreateEventDialog
          categories={categories}
          onClose={() => setShowCreate(false)}
          onCreated={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
