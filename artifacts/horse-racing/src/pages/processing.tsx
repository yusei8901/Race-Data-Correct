import { useState, useEffect, useMemo } from "react";
import {
  Settings2, Plus, Trash2, Pencil, ChevronDown, ChevronRight,
  FolderOpen, Clock, Film, CheckCircle, XCircle, RefreshCcw,
  AlertTriangle, X, CheckSquare, Square, Save, RotateCcw, ClipboardList
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBatchJobs, getGetBatchJobsQueryKey,
  useToggleBatchJob, useDeleteBatchJob, useCreateBatchJob, useUpdateBatchJob,
  useGetAnalysisParams, getGetAnalysisParamsQueryKey,
  useUpdateAnalysisParams,
} from "@workspace/api-client-react";
import type { BatchJob } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ──────────────────────────────────────────────────────────────────────
interface MockVideo {
  id: string;
  filename: string;
  path: string;
  raceInfo: string;
  completedAt?: string;
  status: "完了" | "エラー";
}

const SCHEDULE_OPTIONS = [
  { value: "0 2 * * *", label: "毎日 2:00" },
  { value: "0 14 * * *", label: "毎日 14:00" },
  { value: "0 0 * * 6,0", label: "週末 0:00" },
  { value: "*/30 * * * *", label: "30分ごと" },
  { value: "0 * * * *", label: "毎時" },
];

const FOLDER_OPTIONS = [
  { value: "/videos/daily", label: "日次処理フォルダ (/videos/daily)" },
  { value: "/videos/weekend", label: "週末フォルダ (/videos/weekend)" },
  { value: "/videos/archive", label: "アーカイブ (/videos/archive)" },
  { value: "/videos/urgent", label: "緊急フォルダ (/videos/urgent)" },
];

function cronToLabel(expr: string): string {
  const found = SCHEDULE_OPTIONS.find((s) => s.value === expr);
  return found ? found.label : expr;
}

function generateMockVideos(jobId: string, count: number, type: "pending" | "completed"): MockVideo[] {
  const venues = ["東京", "中山", "阪神", "京都"];
  const results: MockVideo[] = [];
  const seed = jobId.charCodeAt(0) + jobId.charCodeAt(1);
  for (let i = 0; i < count; i++) {
    const num = (seed * (i + 1) * 7) % 900 + 100;
    const venueIdx = (seed + i) % venues.length;
    const raceNum = (i % 12) + 1;
    const filename = `2024031${num}${String(i + 1).padStart(3, "0")}.mp4`;
    const isError = type === "completed" && i % 5 === 2;
    results.push({
      id: `${jobId}-${type}-${i}`,
      filename,
      path: `/videos/daily/${filename}`,
      raceInfo: `${venues[venueIdx]} ${raceNum}R 3歳${i % 2 === 0 ? "未勝利" : "1勝クラス"}`,
      completedAt: type === "completed" ? `2024-03-${String(15 - i).padStart(2, "0")} ${String(i % 24).padStart(2, "0")}:00` : undefined,
      status: isError ? "エラー" : "完了",
    });
  }
  return results;
}

// ── Analysis Params structure ──────────────────────────────────────────────────
interface M200Params {
  polyline_fps: number;
  polyline_resolution: string;
  detection_confidence: number;
  white_balance: number;
  gamma: number;
  saturation: number;
}

interface StraightGeneralParams {
  speed_window: number;
  sampling_fps: number;
  roi_preset: string;
  left_rail_ratio: number;
  bottom_ratio: number;
  course_type: string;
  inference_overlay: boolean;
}

interface StraightAdvancedParams {
  front_mask_scale: number;
  valid_frame_rate: number;
  flow_mad: number;
  accel_threshold: number;
  lane_update_interval: number;
  confidence_threshold: number;
  max_frame_size: string;
  raft_priority: boolean;
  csv_output: boolean;
  debug_log: boolean;
}

interface OtherParams {
  speed_logic: string;
  analysis_fps: number;
  cap_recognition: string;
  noise_reduction: number;
}

interface AnalysisParams {
  m200: M200Params;
  straight_general: StraightGeneralParams;
  straight_advanced: StraightAdvancedParams;
  other: OtherParams;
}

const DEFAULT_PARAMS: AnalysisParams = {
  m200: {
    polyline_fps: 30,
    polyline_resolution: "720p",
    detection_confidence: 70,
    white_balance: 0,
    gamma: 1.0,
    saturation: 0,
  },
  straight_general: {
    speed_window: 0.5,
    sampling_fps: 30,
    roi_preset: "自動検出",
    left_rail_ratio: 15,
    bottom_ratio: 20,
    course_type: "標準",
    inference_overlay: false,
  },
  straight_advanced: {
    front_mask_scale: 1.0,
    valid_frame_rate: 60,
    flow_mad: 2.0,
    accel_threshold: 0.5,
    lane_update_interval: 30,
    confidence_threshold: 75,
    max_frame_size: "1920px",
    raft_priority: false,
    csv_output: false,
    debug_log: false,
  },
  other: {
    speed_logic: "補間法（推奨）",
    analysis_fps: 60,
    cap_recognition: "アダプティブ（推奨）",
    noise_reduction: 50,
  },
};

function getNestedParams(raw: Record<string, any>, surfaceType: string, preset: string): AnalysisParams {
  const nested = raw?.[surfaceType]?.[preset];
  if (!nested) return DEFAULT_PARAMS;
  return {
    m200: { ...DEFAULT_PARAMS.m200, ...(nested.m200 || {}) },
    straight_general: { ...DEFAULT_PARAMS.straight_general, ...(nested.straight_general || {}) },
    straight_advanced: { ...DEFAULT_PARAMS.straight_advanced, ...(nested.straight_advanced || {}) },
    other: { ...DEFAULT_PARAMS.other, ...(nested.other || {}) },
  };
}

// ── Slider Row Component ───────────────────────────────────────────────────────
function SliderRow({
  label, desc, value, min, max, step, unit, onChange, isTurf
}: {
  label: string; desc?: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; isTurf?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-foreground">{label}</div>
          {desc && <div className="text-[10px] text-muted-foreground mt-0.5">{desc}</div>}
        </div>
        <span className="text-xs font-mono text-foreground min-w-[60px] text-right">{value}{unit}</span>
      </div>
      <div style={isTurf ? { "--primary": "142 70% 45%", "--primary-foreground": "0 0% 100%" } as React.CSSProperties : {}}>
        <Slider
          value={[value]}
          min={min} max={max} step={step}
          onValueChange={(v) => onChange(v[0])}
          className="h-4"
        />
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-foreground">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

// ── New Job Dialog ─────────────────────────────────────────────────────────────
function NewJobDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (data: { name: string; cron_expression: string; folder: string }) => void; }) {
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState(SCHEDULE_OPTIONS[0].value);
  const [folder, setFolder] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[480px] max-w-[95vw] p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">新規バッチジョブ作成</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">ジョブ名</label>
            <Input placeholder="バッチジョブの名前" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">スケジュール</label>
            <Select value={schedule} onValueChange={setSchedule}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">対象フォルダ</label>
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="フォルダを選択" />
              </SelectTrigger>
              <SelectContent>
                {FOLDER_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <Button variant="outline" onClick={onClose} className="h-8 text-xs cursor-pointer">キャンセル</Button>
          <Button
            onClick={() => name && folder && onCreate({ name, cron_expression: schedule, folder })}
            disabled={!name || !folder}
            className="h-8 text-xs bg-primary hover:bg-primary/90 cursor-pointer"
          >
            作成
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Job Dialog ────────────────────────────────────────────────────────────
function EditJobDialog({
  job, onClose, onSave,
}: {
  job: BatchJob; onClose: () => void;
  onSave: (data: { name: string; cron_expression: string; folder: string; videos: string[]; file_mode: string }) => void;
}) {
  const [name, setName] = useState(job.name);
  const [schedule, setSchedule] = useState(job.cron_expression || SCHEDULE_OPTIONS[0].value);
  const [folder, setFolder] = useState(FOLDER_OPTIONS[0].value);
  const [fileMode, setFileMode] = useState<"folder" | "individual">("folder");
  const mockVideos = useMemo(() => generateMockVideos(job.id, 30, "pending"), [job.id]);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());

  const allSelected = selectedVideos.size === mockVideos.length;

  const toggleVideo = (id: string) => {
    setSelectedVideos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[560px] max-w-[95vw] flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-5 border-b border-zinc-700">
          <h2 className="text-base font-semibold">バッチジョブ編集</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">ジョブ名</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">スケジュール</label>
            <Select value={schedule} onValueChange={setSchedule}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">対象フォルダ</label>
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOLDER_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">処理対象動画</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedVideos(new Set(mockVideos.map((v) => v.id)))}
                  className="text-[10px] text-primary hover:underline cursor-pointer"
                >全選択</button>
                <button
                  onClick={() => setSelectedVideos(new Set())}
                  className="text-[10px] text-muted-foreground hover:underline cursor-pointer"
                >選択解除</button>
              </div>
            </div>
            <div className="border border-zinc-700 rounded-md max-h-[180px] overflow-auto">
              {mockVideos.map((v) => (
                <label
                  key={v.id}
                  className="flex items-start gap-2 px-3 py-2 hover:bg-zinc-800/50 cursor-pointer border-b border-zinc-800/50 last:border-0"
                >
                  <Checkbox
                    checked={selectedVideos.has(v.id)}
                    onCheckedChange={() => toggleVideo(v.id)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-medium text-foreground">{v.filename}</div>
                    <div className="text-[10px] text-muted-foreground">{v.raceInfo}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">{selectedVideos.size}/{mockVideos.length} 件選択中</div>
          </div>
          {selectedVideos.size > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">実行モード（定期実行時）</label>
              <div className="flex gap-2">
                {(["folder", "individual"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setFileMode(m)}
                    className={`flex-1 py-1.5 px-3 rounded border text-xs transition-colors cursor-pointer ${
                      fileMode === m
                        ? "bg-primary/20 border-primary text-primary"
                        : "bg-zinc-800 border-zinc-700 text-muted-foreground hover:border-zinc-500"
                    }`}
                  >
                    {m === "folder" ? "フォルダ内全ファイルで実行" : "個別ファイルで実行"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 justify-end p-4 border-t border-zinc-700">
          <Button variant="outline" onClick={onClose} className="h-8 text-xs cursor-pointer">キャンセル</Button>
          <Button
            onClick={() => onSave({ name, cron_expression: schedule, folder, videos: Array.from(selectedVideos), file_mode: fileMode })}
            className="h-8 text-xs bg-primary cursor-pointer"
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Job Row (expandable) ───────────────────────────────────────────────────────
function JobRow({
  job, onToggle, onEdit, onDelete,
}: {
  job: BatchJob;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingPage, setPendingPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const [selectedErrorIds, setSelectedErrorIds] = useState<Set<string>>(new Set());
  const [showMoveConfirm, setShowMoveConfirm] = useState(false);
  const [pendingVideos, setPendingVideos] = useState(() => generateMockVideos(job.id, 20, "pending"));
  const [completedJobs, setCompletedJobs] = useState(() => generateMockVideos(job.id, 30, "completed"));

  const { toast } = useToast();
  const PAGE_SIZE = 4;
  const pendingTotal = pendingVideos.length;
  const completedTotal = completedJobs.length;
  const errorCount = completedJobs.filter((j) => j.status === "エラー").length;

  const pendingSlice = pendingVideos.slice((pendingPage - 1) * PAGE_SIZE, pendingPage * PAGE_SIZE);
  const completedSlice = completedJobs.slice((completedPage - 1) * PAGE_SIZE, completedPage * PAGE_SIZE);

  const toggleError = (id: string) => {
    setSelectedErrorIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleMoveToPending = () => {
    const toMove = completedJobs.filter((j) => selectedErrorIds.has(j.id));
    setCompletedJobs((prev) => prev.filter((j) => !selectedErrorIds.has(j.id)));
    setPendingVideos((prev) => [...prev, ...toMove.map((v) => ({ ...v, completedAt: undefined, status: "完了" as const }))]);
    setSelectedErrorIds(new Set());
    setShowMoveConfirm(false);
    toast({ title: `${toMove.length}件を処理待ちに移動しました` });
  };

  const mockFolder = FOLDER_OPTIONS[job.id.charCodeAt(0) % FOLDER_OPTIONS.length].value;
  const mockLastRun = `2024-03-${String(15 - (job.id.charCodeAt(1) % 10)).padStart(2, "0")} ${String(job.id.charCodeAt(2) % 24).padStart(2, "0")}:00`;

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 bg-zinc-900/60 hover:bg-zinc-900/80 transition-colors">
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-white cursor-pointer flex-shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 flex items-center gap-3 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <span className="font-medium text-sm truncate">{job.name}</span>
          <Badge variant="outline" className="text-[10px] font-mono shrink-0">{cronToLabel(job.cron_expression)}</Badge>
          {job.next_run_at && (
            <span className="text-[10px] text-muted-foreground shrink-0">次回: {job.next_run_at}</span>
          )}
          <Badge
            variant={job.status === "実行中" ? "default" : job.status === "有効" ? "outline" : "secondary"}
            className={`text-[10px] shrink-0 ${job.status === "実行中" ? "bg-blue-600" : job.status === "有効" ? "text-green-500 border-green-800 bg-green-950/20" : ""}`}
          >
            {job.status || "有効"}
          </Badge>
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Film className="h-3 w-3" />処理待ち <span className="text-yellow-400 font-semibold">{pendingTotal}件</span>
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />処理済み <span className="text-green-400 font-semibold">{completedTotal}件</span>
              {errorCount > 0 && <span className="text-red-400 font-semibold">({errorCount}エラー)</span>}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 ml-3">
          <button onClick={onEdit} className="p-1 text-zinc-400 hover:text-white transition-colors cursor-pointer" title="編集">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="p-1 text-red-500 hover:text-red-400 transition-colors cursor-pointer" title="削除">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <Switch checked={job.is_enabled} onCheckedChange={onToggle} className="scale-75" />
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-zinc-800 bg-zinc-950/40 p-4 space-y-4">
          {/* Meta */}
          <div className="flex gap-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><FolderOpen className="h-3.5 w-3.5" />対象フォルダ: <span className="text-foreground font-mono">{mockFolder}</span></span>
            <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />最終実行: <span className="text-foreground">{mockLastRun}</span></span>
          </div>

          {/* Pending Videos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-yellow-400">処理待ち動画（{pendingTotal}件）</span>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{pendingPage}/{Math.ceil(pendingTotal / PAGE_SIZE)} ページ</span>
                <button disabled={pendingPage <= 1} onClick={() => setPendingPage((p) => p - 1)} className="hover:text-white disabled:opacity-30 cursor-pointer">前へ</button>
                <button disabled={pendingPage >= Math.ceil(pendingTotal / PAGE_SIZE)} onClick={() => setPendingPage((p) => p + 1)} className="hover:text-white disabled:opacity-30 cursor-pointer">次へ</button>
              </div>
            </div>
            <div className="border border-zinc-800 rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-zinc-800/60">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-muted-foreground w-8">No.</th>
                    <th className="px-3 py-1.5 text-left text-muted-foreground">ファイル名</th>
                    <th className="px-3 py-1.5 text-left text-muted-foreground">パス</th>
                    <th className="px-3 py-1.5 text-left text-muted-foreground">レース情報</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingSlice.map((v, i) => (
                    <tr key={v.id} className="border-t border-zinc-800/50 hover:bg-zinc-800/20">
                      <td className="px-3 py-1.5 text-muted-foreground">{(pendingPage - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-3 py-1.5 font-mono text-foreground">{v.filename}</td>
                      <td className="px-3 py-1.5 text-zinc-500 font-mono text-[10px]">{v.path}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{v.raceInfo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Completed Jobs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-green-400">処理済みジョブ（{completedTotal}件）</span>
              <div className="flex items-center gap-2">
                {selectedErrorIds.size > 0 && (
                  <Button
                    size="sm"
                    className="h-6 text-[10px] bg-yellow-700 hover:bg-yellow-600 text-white border-0 cursor-pointer"
                    onClick={() => setShowMoveConfirm(true)}
                  >
                    選択した{selectedErrorIds.size}件を処理待ちへ移動
                  </Button>
                )}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{completedPage}/{Math.ceil(completedTotal / PAGE_SIZE)} ページ</span>
                  <button disabled={completedPage <= 1} onClick={() => setCompletedPage((p) => p - 1)} className="hover:text-white disabled:opacity-30 cursor-pointer">前へ</button>
                  <button disabled={completedPage >= Math.ceil(completedTotal / PAGE_SIZE)} onClick={() => setCompletedPage((p) => p + 1)} className="hover:text-white disabled:opacity-30 cursor-pointer">次へ</button>
                </div>
              </div>
            </div>
            <div className="border border-zinc-800 rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-zinc-800/60">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-muted-foreground w-8">No.</th>
                    <th className="px-3 py-1.5 text-left text-muted-foreground">動画名</th>
                    <th className="px-3 py-1.5 text-left text-muted-foreground">レース情報</th>
                    <th className="px-3 py-1.5 text-left text-muted-foreground">完了日時</th>
                    <th className="px-3 py-1.5 text-center text-muted-foreground">結果</th>
                    <th className="px-3 py-1.5 text-center text-muted-foreground w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {completedSlice.map((v, i) => (
                    <tr key={v.id} className={`border-t border-zinc-800/50 hover:bg-zinc-800/20 ${selectedErrorIds.has(v.id) ? "bg-yellow-950/20" : ""}`}>
                      <td className="px-3 py-1.5 text-muted-foreground">{(completedPage - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-3 py-1.5 font-mono text-foreground">{v.filename}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{v.raceInfo}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{v.completedAt}</td>
                      <td className="px-3 py-1.5 text-center">
                        {v.status === "完了" ? (
                          <span className="inline-flex items-center gap-1 text-green-400 text-[10px]"><CheckCircle className="h-3 w-3" />完了</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-400 text-[10px]"><XCircle className="h-3 w-3" />エラー</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {v.status === "エラー" && (
                          <Checkbox
                            checked={selectedErrorIds.has(v.id)}
                            onCheckedChange={() => toggleError(v.id)}
                            className="cursor-pointer"
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Move confirm dialog */}
      {showMoveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-[400px]">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold mb-1">処理待ちへ移動</div>
                <div className="text-xs text-muted-foreground">選択した {selectedErrorIds.size} 件のエラー動画を処理待ちに移動しますか？</div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowMoveConfirm(false)} className="h-7 text-xs cursor-pointer">キャンセル</Button>
              <Button size="sm" onClick={handleMoveToPending} className="h-7 text-xs bg-yellow-700 hover:bg-yellow-600 text-white border-0 cursor-pointer">移動する</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Analysis Params Panel ──────────────────────────────────────────────────────
const RACE_TYPE_VENUES: Record<string, { id: string; name: string }[]> = {
  "中央競馬": [
    { id: "tokyo", name: "東京" },
    { id: "nakayama", name: "中山" },
    { id: "kyoto", name: "京都" },
    { id: "hanshin", name: "阪神" },
    { id: "chukyo", name: "中京" },
    { id: "kokura", name: "小倉" },
    { id: "niigata", name: "新潟" },
    { id: "hakodate", name: "函館" },
    { id: "sapporo", name: "札幌" },
    { id: "fukushima", name: "福島" },
  ],
  "地方競馬": [
    { id: "ooi", name: "大井" },
    { id: "kawasaki", name: "川崎" },
    { id: "funabashi", name: "船橋" },
    { id: "urawa", name: "浦和" },
    { id: "nagoya", name: "名古屋" },
    { id: "kochi", name: "高知" },
    { id: "saga", name: "佐賀" },
  ],
  "海外競馬": [
    { id: "longchamp", name: "ロンシャン" },
    { id: "ascot", name: "アスコット" },
    { id: "churchill", name: "チャーチルダウンズ" },
    { id: "sha_tin", name: "シャティン" },
  ],
};

const ANALYSIS_PRESETS = ["標準", "逆光用", "曇り用", "雨天用"];

function AnalysisParamsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [raceType, setRaceType] = useState<string>("中央競馬");
  const [selectedVenueId, setSelectedVenueId] = useState<string>("tokyo");
  const [surfaceType, setSurfaceType] = useState<"芝" | "ダート">("芝");
  const [preset, setPreset] = useState<string>("標準");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [params, setParams] = useState<AnalysisParams>(DEFAULT_PARAMS);
  const [isDirty, setIsDirty] = useState(false);

  const { data: paramsData, isLoading } = useGetAnalysisParams(
    selectedVenueId,
    { query: { enabled: !!selectedVenueId, queryKey: getGetAnalysisParamsQueryKey(selectedVenueId) } }
  );

  const updateParams = useUpdateAnalysisParams();

  useEffect(() => {
    if (paramsData) {
      const loaded = getNestedParams(paramsData.params || {}, surfaceType, preset);
      setParams(loaded);
      setIsDirty(false);
    }
  }, [paramsData, surfaceType, preset]);

  const venues = RACE_TYPE_VENUES[raceType] || [];

  useEffect(() => {
    if (!venues.find((v) => v.id === selectedVenueId)) {
      setSelectedVenueId(venues[0]?.id || "");
    }
  }, [raceType]);

  const updateM200 = (key: keyof M200Params, val: any) => {
    setParams((p) => ({ ...p, m200: { ...p.m200, [key]: val } }));
    setIsDirty(true);
  };
  const updateSG = (key: keyof StraightGeneralParams, val: any) => {
    setParams((p) => ({ ...p, straight_general: { ...p.straight_general, [key]: val } }));
    setIsDirty(true);
  };
  const updateSA = (key: keyof StraightAdvancedParams, val: any) => {
    setParams((p) => ({ ...p, straight_advanced: { ...p.straight_advanced, [key]: val } }));
    setIsDirty(true);
  };
  const updateOther = (key: keyof OtherParams, val: any) => {
    setParams((p) => ({ ...p, other: { ...p.other, [key]: val } }));
    setIsDirty(true);
  };

  const handleSave = () => {
    if (!selectedVenueId) return;
    const existingRaw = (paramsData?.params as Record<string, any>) || {};
    const updated = {
      ...existingRaw,
      [surfaceType]: {
        ...(existingRaw[surfaceType] || {}),
        [preset]: params,
      },
    };
    updateParams.mutate({ venueId: selectedVenueId, data: { params: updated } }, {
      onSuccess: () => {
        toast({ title: "パラメータを保存しました" });
        queryClient.invalidateQueries({ queryKey: getGetAnalysisParamsQueryKey(selectedVenueId) });
        setIsDirty(false);
      },
      onError: () => toast({ title: "保存に失敗しました", variant: "destructive" }),
    });
  };

  const handleReset = () => {
    setParams(DEFAULT_PARAMS);
    setIsDirty(true);
  };

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Left: Venue Selection */}
      <div className="w-[200px] shrink-0 flex flex-col gap-3">
        <div className="border border-border rounded-lg bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground mb-2">競馬の種類</div>
          <div className="flex flex-col gap-1">
            {Object.keys(RACE_TYPE_VENUES).map((rt) => (
              <button
                key={rt}
                onClick={() => setRaceType(rt)}
                className={`text-left px-2 py-1.5 rounded text-xs transition-colors cursor-pointer ${
                  raceType === rt ? "bg-primary/20 text-primary font-medium" : "text-foreground hover:bg-muted"
                }`}
              >
                {rt}
              </button>
            ))}
          </div>
          <div className="border-t border-border mt-3 pt-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">競馬場</div>
            <div className="flex flex-col gap-0.5 max-h-[240px] overflow-auto">
              {venues.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVenueId(v.id)}
                  className={`text-left px-2 py-1.5 rounded text-xs transition-colors cursor-pointer ${
                    selectedVenueId === v.id ? "bg-primary/20 text-primary font-medium" : "text-foreground hover:bg-muted"
                  }`}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right: Params */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Course + Preset */}
        <div className="border border-border rounded-lg bg-card p-3 mb-3 flex items-center gap-4">
          <div>
            <div className="text-[10px] text-muted-foreground mb-1">コース種別</div>
            <div className="flex gap-1">
              {(["芝", "ダート"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSurfaceType(s)}
                  className={`px-3 py-1 rounded text-xs border transition-colors cursor-pointer ${
                    surfaceType === s ? "bg-primary/20 border-primary text-primary" : "bg-zinc-800 border-zinc-700 text-muted-foreground hover:border-zinc-500"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground mb-1">解析プリセット</div>
            <div className="flex gap-1">
              {ANALYSIS_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`px-3 py-1 rounded text-xs border transition-colors cursor-pointer ${
                    preset === p ? "bg-primary/20 border-primary text-primary" : "bg-zinc-800 border-zinc-700 text-muted-foreground hover:border-zinc-500"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto text-[10px] text-muted-foreground">
            {venues.find((v) => v.id === selectedVenueId)?.name || "-"} / {surfaceType} / {preset}
          </div>
        </div>

        {/* Param sections scrollable */}
        <div className="flex-1 overflow-auto space-y-3">
          {/* 200m params */}
          <div className="border border-border rounded-lg bg-card p-4 space-y-4">
            <div className="text-sm font-semibold text-foreground border-b border-border pb-2">200mごとの集計パラメータ</div>
            <SliderRow label="ポリライン検出頻度" desc="白線のポリライン検出を実行するフレーム頻度" value={params.m200.polyline_fps} min={1} max={60} step={1} unit=" fps" onChange={(v) => updateM200("polyline_fps", v)} isTurf={surfaceType === "芝"} />
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-foreground">ポリライン検出解像度</div>
              <div className="text-[10px] text-muted-foreground">ポリライン検出時の解像度。高いほど精度向上</div>
              <Select value={params.m200.polyline_resolution} onValueChange={(v) => updateM200("polyline_resolution", v)}>
                <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["360p", "480p", "720p", "1080p"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <SliderRow label="物体検知モデル確証度閾値" desc="馬や騎手を検出する際の確証度の最低閾値" value={params.m200.detection_confidence} min={0} max={100} step={1} unit="%" onChange={(v) => updateM200("detection_confidence", v)} isTurf={surfaceType === "芝"} />
            <SliderRow label="ホワイトバランス調整" desc="逆光や曇り時の色温度補正" value={params.m200.white_balance} min={-100} max={100} step={1} unit="" onChange={(v) => updateM200("white_balance", v)} isTurf={surfaceType === "芝"} />
            <SliderRow label="ガンマ補正" desc="明暗コントラスト調整（1.0が標準）" value={params.m200.gamma} min={0.1} max={3.0} step={0.1} unit="" onChange={(v) => updateM200("gamma", parseFloat(v.toFixed(1)))} isTurf={surfaceType === "芝"} />
            <SliderRow label="彩度調整" desc="帽色検出向上のための彩度調整" value={params.m200.saturation} min={0} max={100} step={1} unit="%" onChange={(v) => updateM200("saturation", v)} isTurf={surfaceType === "芝"} />
          </div>

          {/* Straight general */}
          <div className="border border-border rounded-lg bg-card p-4 space-y-4">
            <div className="text-sm font-semibold text-foreground border-b border-border pb-2">最後の直線パラメータ - 一般設定</div>
            <SliderRow label="速度集計ウィンドウ（秒）" desc="速度を平均化する時間幅" value={params.straight_general.speed_window} min={0.1} max={2.0} step={0.1} unit="s" onChange={(v) => updateSG("speed_window", parseFloat(v.toFixed(1)))} isTurf={surfaceType === "芝"} />
            <SliderRow label="サンプリングFPS" desc="解析時のサンプリングフレームレート" value={params.straight_general.sampling_fps} min={1} max={60} step={1} unit=" fps" onChange={(v) => updateSG("sampling_fps", v)} isTurf={surfaceType === "芝"} />
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-foreground">ROIプリセット</div>
              <div className="text-[10px] text-muted-foreground">関心領域の自動検出プリセット</div>
              <Select value={params.straight_general.roi_preset} onValueChange={(v) => updateSG("roi_preset", v)}>
                <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["自動検出", "固定", "カスタム"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <SliderRow label="左ラチ帯の幅比率" desc="" value={params.straight_general.left_rail_ratio} min={0} max={50} step={1} unit="%" onChange={(v) => updateSG("left_rail_ratio", v)} isTurf={surfaceType === "芝"} />
            <SliderRow label="下帯の高さ比率" desc="" value={params.straight_general.bottom_ratio} min={0} max={50} step={1} unit="%" onChange={(v) => updateSG("bottom_ratio", v)} isTurf={surfaceType === "芝"} />
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-foreground">直線距離のコース種別</div>
              <Select value={params.straight_general.course_type} onValueChange={(v) => updateSG("course_type", v)}>
                <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["標準", "短距離", "長距離"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <ToggleRow label="推論フレームオーバーレイ" value={params.straight_general.inference_overlay} onChange={(v) => updateSG("inference_overlay", v)} />
          </div>

          {/* Straight advanced (collapsible) */}
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 text-sm font-semibold text-foreground hover:bg-muted/20 transition-colors cursor-pointer"
              onClick={() => setAdvancedOpen(!advancedOpen)}
            >
              <span>最後の直線パラメータ - 高度な設定</span>
              <span className="text-[10px] text-primary">{advancedOpen ? "閉じる ∧" : "展開 ∨"}</span>
            </button>
            {advancedOpen && (
              <div className="px-4 pb-4 space-y-4 border-t border-border">
                <div className="pt-4" />
                <SliderRow label="前景マスク倍率" desc="" value={params.straight_advanced.front_mask_scale} min={0.5} max={3.0} step={0.1} unit="x" onChange={(v) => updateSA("front_mask_scale", parseFloat(v.toFixed(1)))} isTurf={surfaceType === "芝"} />
                <SliderRow label="有効画素率" desc="" value={params.straight_advanced.valid_frame_rate} min={0} max={100} step={1} unit="%" onChange={(v) => updateSA("valid_frame_rate", v)} isTurf={surfaceType === "芝"} />
                <SliderRow label="フローMAD" desc="" value={params.straight_advanced.flow_mad} min={0} max={10} step={0.1} unit="" onChange={(v) => updateSA("flow_mad", parseFloat(v.toFixed(1)))} isTurf={surfaceType === "芝"} />
                <SliderRow label="加減速判定しきい値" desc="" value={params.straight_advanced.accel_threshold} min={0} max={2.0} step={0.1} unit="" onChange={(v) => updateSA("accel_threshold", parseFloat(v.toFixed(1)))} isTurf={surfaceType === "芝"} />
                <SliderRow label="標検出更新間隔" desc="" value={params.straight_advanced.lane_update_interval} min={1} max={60} step={1} unit="f" onChange={(v) => updateSA("lane_update_interval", v)} isTurf={surfaceType === "芝"} />
                <SliderRow label="信頼度閾値" desc="" value={params.straight_advanced.confidence_threshold} min={0} max={100} step={1} unit="%" onChange={(v) => updateSA("confidence_threshold", v)} isTurf={surfaceType === "芝"} />
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs font-medium text-foreground">最大フレームサイズ</div>
                  <Select value={params.straight_advanced.max_frame_size} onValueChange={(v) => updateSA("max_frame_size", v)}>
                    <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["1280px", "1920px", "2560px"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-4 pt-1">
                  <ToggleRow label="RAFT優先" value={params.straight_advanced.raft_priority} onChange={(v) => updateSA("raft_priority", v)} />
                  <ToggleRow label="CSV詳細出力" value={params.straight_advanced.csv_output} onChange={(v) => updateSA("csv_output", v)} />
                  <ToggleRow label="デバッグログ" value={params.straight_advanced.debug_log} onChange={(v) => updateSA("debug_log", v)} />
                </div>
              </div>
            )}
          </div>

          {/* Other params */}
          <div className="border border-border rounded-lg bg-card p-4 space-y-4">
            <div className="text-sm font-semibold text-foreground border-b border-border pb-2">速度算出パラメータ</div>
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-foreground">速度算出ロジック</div>
              <div className="text-[10px] text-muted-foreground">馬の速度を算出するアルゴリズム。補間法が最もバランスが良い。</div>
              <Select value={params.other.speed_logic} onValueChange={(v) => updateOther("speed_logic", v)}>
                <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["補間法（推奨）", "差分法", "平均法"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <SliderRow label="解析フレームレート" desc="解析時のフレームレート。高いほど精度が向上するが処理時間が増加。" value={params.other.analysis_fps} min={1} max={120} step={1} unit=" fps" onChange={(v) => updateOther("analysis_fps", v)} isTurf={surfaceType === "芝"} />
          </div>

          <div className="border border-border rounded-lg bg-card p-4 space-y-4">
            <div className="text-sm font-semibold text-foreground border-b border-border pb-2">画像処理パラメータ</div>
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-foreground">帽色認識モード</div>
              <div className="text-[10px] text-muted-foreground">騎手の帽色を認識する方式。アダプティブが照明変化に強い。</div>
              <Select value={params.other.cap_recognition} onValueChange={(v) => updateOther("cap_recognition", v)}>
                <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["アダプティブ（推奨）", "固定", "学習済み"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <SliderRow label="ノイズ除去レベル" desc="映像のノイズを除去するレベル。高すぎると細部が失われる可能性。" value={params.other.noise_reduction} min={0} max={100} step={1} unit="%" onChange={(v) => updateOther("noise_reduction", v)} isTurf={surfaceType === "芝"} />
          </div>

          <div className="h-4" />
        </div>

        {/* Footer buttons */}
        <div className="border-t border-border pt-3 flex items-center justify-between mt-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 cursor-pointer" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5" />デフォルトに戻す
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 bg-primary hover:bg-primary/90 cursor-pointer"
            onClick={handleSave}
            disabled={!isDirty || updateParams.isPending}
          >
            <Save className="h-3.5 w-3.5" />パラメータを保存
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Audit Log Panel ─────────────────────────────────────────────────────────────

const FASTAPI_URL = `${BASE_URL}/fastapi`;

interface AuditLogItem {
  id: string;
  user_id: string | null;
  action: string;
  target_table: string;
  target_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(50);

  const fetchLogs = () => {
    setLoading(true);
    fetch(`${FASTAPI_URL}/audit-logs?limit=${limit}`)
      .then((r) => r.json())
      .then((d) => setLogs(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLogs(); }, [limit]);

  const ACTION_COLOR: Record<string, string> = {
    STATUS_CHANGE: "text-cyan-400",
    CREATE: "text-green-400",
    UPDATE: "text-yellow-400",
    DELETE: "text-red-400",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">監査ログ</h2>
        <div className="flex items-center gap-2">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="h-7 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 text-zinc-300"
          >
            {[50, 100, 200].map((n) => (
              <option key={n} value={n}>{n}件</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={fetchLogs} className="h-7 text-xs cursor-pointer border-zinc-700 gap-1">
            <RefreshCcw className="h-3 w-3" />更新
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="text-xs text-zinc-500 py-8 text-center">読み込み中...</div>
      ) : logs.length === 0 ? (
        <div className="text-xs text-zinc-600 py-8 text-center">監査ログがありません</div>
      ) : (
        <div className="border border-zinc-800 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-zinc-800/60">
              <tr>
                <th className="px-3 py-1.5 text-left text-zinc-500 font-normal">日時</th>
                <th className="px-3 py-1.5 text-left text-zinc-500 font-normal">アクション</th>
                <th className="px-3 py-1.5 text-left text-zinc-500 font-normal">テーブル</th>
                <th className="px-3 py-1.5 text-left text-zinc-500 font-normal">対象ID</th>
                <th className="px-3 py-1.5 text-left text-zinc-500 font-normal">変更内容</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-zinc-800/50 hover:bg-zinc-800/20">
                  <td className="px-3 py-1.5 text-zinc-500 whitespace-nowrap font-mono">
                    {log.created_at ? log.created_at.slice(0, 19).replace("T", " ") : "-"}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`font-medium ${ACTION_COLOR[log.action] || "text-zinc-300"}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-zinc-400">{log.target_table}</td>
                  <td className="px-3 py-1.5 text-zinc-500 font-mono">{log.target_id?.slice(0, 8)}...</td>
                  <td className="px-3 py-1.5 text-zinc-500">
                    {log.new_value ? (
                      <span>
                        {Object.entries(log.new_value)
                          .filter(([k]) => k !== "batch")
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" / ")}
                      </span>
                    ) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ProcessingManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<BatchJob | null>(null);

  const { data: jobs, isLoading: isJobsLoading } = useGetBatchJobs({
    query: { queryKey: getGetBatchJobsQueryKey() }
  });

  const toggleJob = useToggleBatchJob();
  const deleteJob = useDeleteBatchJob();
  const createJob = useCreateBatchJob();
  const updateJob = useUpdateBatchJob();

  const handleToggle = (job: BatchJob) => {
    toggleJob.mutate({ id: job.id }, {
      onSuccess: () => {
        toast({ title: `ジョブを${job.is_enabled ? "無効化" : "有効化"}しました` });
        queryClient.invalidateQueries({ queryKey: getGetBatchJobsQueryKey() });
      }
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("このバッチジョブを削除しますか？")) {
      deleteJob.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "ジョブを削除しました" });
          queryClient.invalidateQueries({ queryKey: getGetBatchJobsQueryKey() });
        }
      });
    }
  };

  const handleCreate = (data: { name: string; cron_expression: string; folder: string }) => {
    createJob.mutate({ data: { name: data.name, cron_expression: data.cron_expression, is_enabled: true } }, {
      onSuccess: () => {
        toast({ title: "バッチジョブを作成しました" });
        setIsCreateOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetBatchJobsQueryKey() });
      },
      onError: () => toast({ title: "エラーが発生しました", variant: "destructive" }),
    });
  };

  const handleEditSave = (data: { name: string; cron_expression: string; folder: string; videos: string[]; file_mode: string }) => {
    if (!editingJob) return;
    updateJob.mutate({ id: editingJob.id, data: { name: data.name, cron_expression: data.cron_expression } }, {
      onSuccess: () => {
        toast({ title: "バッチジョブを更新しました" });
        setEditingJob(null);
        queryClient.invalidateQueries({ queryKey: getGetBatchJobsQueryKey() });
      },
      onError: () => toast({ title: "更新に失敗しました", variant: "destructive" }),
    });
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <h1 className="text-base font-semibold text-foreground">処理管理</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5 cursor-pointer"
          onClick={() => queryClient.invalidateQueries({ queryKey: getGetBatchJobsQueryKey() })}
        >
          <RefreshCcw className="h-3.5 w-3.5" />更新
        </Button>
      </div>

      <Tabs defaultValue="batch" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent h-10 p-0 px-6">
          <TabsTrigger
            value="batch"
            className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-4 h-full text-sm font-medium gap-1.5"
          >
            <Settings2 className="h-3.5 w-3.5" />バッチ管理
          </TabsTrigger>
          <TabsTrigger
            value="analysis"
            className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-4 h-full text-sm font-medium gap-1.5"
          >
            <Film className="h-3.5 w-3.5" />解析ツール管理
          </TabsTrigger>
          <TabsTrigger
            value="audit"
            className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-4 h-full text-sm font-medium gap-1.5"
          >
            <ClipboardList className="h-3.5 w-3.5" />監査ログ
          </TabsTrigger>
        </TabsList>

        <TabsContent value="batch" className="flex-1 flex flex-col mt-0 p-6 overflow-hidden focus-visible:outline-none">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">バッチジョブ設定</h2>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-primary hover:bg-primary/90 cursor-pointer"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />新規ジョブ作成
            </Button>
          </div>
          <div className="flex-1 overflow-auto space-y-2">
            {isJobsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 border border-zinc-800 rounded-lg bg-zinc-900/60 animate-pulse" />
              ))
            ) : !jobs?.length ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm border border-border rounded-lg">
                バッチジョブが登録されていません
              </div>
            ) : (
              jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onToggle={() => handleToggle(job)}
                  onEdit={() => setEditingJob(job)}
                  onDelete={() => handleDelete(job.id)}
                />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="analysis" className="flex-1 flex flex-col mt-0 p-6 overflow-hidden focus-visible:outline-none">
          <AnalysisParamsPanel />
        </TabsContent>

        <TabsContent value="audit" className="flex-1 flex flex-col mt-0 p-6 overflow-auto focus-visible:outline-none">
          <AuditLogPanel />
        </TabsContent>
      </Tabs>

      {isCreateOpen && (
        <NewJobDialog onClose={() => setIsCreateOpen(false)} onCreate={handleCreate} />
      )}
      {editingJob && (
        <EditJobDialog job={editingJob} onClose={() => setEditingJob(null)} onSave={handleEditSave} />
      )}
    </div>
  );
}
