import { useState } from "react";
import {
  Settings2, RefreshCcw, Play, ChevronDown, ChevronRight,
  Clock, CheckCircle, XCircle, AlertTriangle, X, Film,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/contexts/user-role";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = BASE_URL + "/fastapi";
const ADMIN_HEADER = { "X-Dev-User-Id": "10" };

// ── Types ─────────────────────────────────────────────────────────────────
interface LastRun {
  id: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  processedCount: number;
  errorCount: number;
}

interface BatchJob {
  id: number;
  name: string;
  targetType: string;
  targetFolder: string;
  scheduleType: string;
  scheduleTime: string;
  enabled: boolean;
  lastRun: LastRun | null;
  updatedAt: string | null;
}

interface SyncJob {
  syncJobId: number;
  holdingDate: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function statusBadgeClass(status: string): string {
  if (status === "SUCCESS") return "bg-green-900/40 text-green-400 border-green-800";
  if (status === "PARTIAL_SUCCESS") return "bg-yellow-900/40 text-yellow-400 border-yellow-800";
  if (status === "RUNNING") return "bg-blue-900/40 text-blue-400 border-blue-800";
  if (status === "FAILED") return "bg-red-900/40 text-red-400 border-red-700";
  if (status === "PENDING") return "bg-zinc-800/60 text-zinc-400 border-zinc-700";
  return "bg-zinc-800/60 text-zinc-400 border-zinc-700";
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    SUCCESS: "成功", PARTIAL_SUCCESS: "一部成功", RUNNING: "実行中",
    FAILED: "失敗", PENDING: "待機中",
  };
  return map[status] ?? status;
}

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch { return "-"; }
}

// ── Batch Job Row ─────────────────────────────────────────────────────────
function BatchJobRow({ job, onRun }: { job: BatchJob; onRun: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 bg-zinc-900/60 hover:bg-zinc-900/80 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <button className="text-muted-foreground flex-shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex-1 flex items-center gap-3 min-w-0">
          <span className="font-medium text-sm truncate">{job.name}</span>
          <Badge variant="outline" className="text-[10px] shrink-0 bg-zinc-800/60 text-zinc-400 border-zinc-700">
            {job.scheduleType} {job.scheduleTime}
          </Badge>
          <span className="text-[10px] text-muted-foreground truncate hidden sm:block">
            {job.targetFolder}
          </span>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {job.lastRun && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${statusBadgeClass(job.lastRun.status)}`}>
              {statusLabel(job.lastRun.status)}
            </span>
          )}
          <Switch
            checked={job.enabled}
            onCheckedChange={() => {}}
            className="scale-75"
            onClick={(e) => e.stopPropagation()}
          />
          <Button
            size="sm"
            className="h-6 text-[10px] gap-1 bg-primary/80 hover:bg-primary cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onRun(job.id); }}
          >
            <Play className="h-3 w-3" />実行
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-zinc-800 bg-zinc-950/40 p-4 text-xs text-muted-foreground space-y-2">
          <div className="flex gap-6 flex-wrap">
            <span>対象フォルダ: <span className="font-mono text-foreground">{job.targetFolder}</span></span>
            <span>スケジュール: <span className="text-foreground">{job.scheduleType} {job.scheduleTime}</span></span>
          </div>
          {job.lastRun && (
            <div className="flex gap-6 flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />開始: <span className="text-foreground">{formatTime(job.lastRun.startedAt)}</span>
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />完了: <span className="text-foreground">{formatTime(job.lastRun.completedAt)}</span>
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-400" />成功: <span className="text-green-400">{job.lastRun.processedCount}件</span>
              </span>
              {job.lastRun.errorCount > 0 && (
                <span className="flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-red-400" />エラー: <span className="text-red-400">{job.lastRun.errorCount}件</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────
export default function ProcessingManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [syncDate, setSyncDate] = useState("");

  // Batch jobs
  const { data: batchData, isLoading: batchLoading, refetch: refetchBatch } = useQuery<{ items: BatchJob[] }>({
    queryKey: ["batch-jobs"],
    queryFn: async () => {
      const res = await fetch(`${API}/batch-jobs`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });
  const batchJobs = batchData?.items ?? [];

  // Sync jobs
  const { data: syncData, isLoading: syncLoading, refetch: refetchSync } = useQuery<{ items: SyncJob[] }>({
    queryKey: ["sync-jobs"],
    queryFn: async () => {
      const res = await fetch(`${API}/race-sync-jobs?limit=20`, { headers: ADMIN_HEADER });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });
  const syncJobs = syncData?.items ?? [];

  // Run batch job
  const runJobMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const res = await fetch(`${API}/batch-jobs/${jobId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ADMIN_HEADER },
        body: "{}",
      });
      if (!res.ok) throw new Error("Failed to run job");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch-jobs"] });
      toast({ title: "バッチジョブを開始しました" });
    },
    onError: () => toast({ title: "バッチジョブの実行に失敗しました", variant: "destructive" }),
  });

  // Create sync job
  const createSyncMutation = useMutation({
    mutationFn: async (holdingDate: string) => {
      const res = await fetch(`${API}/race-sync-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ADMIN_HEADER },
        body: JSON.stringify({ holdingDate }),
      });
      if (!res.ok) throw new Error("Failed to create sync job");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sync-jobs"] });
      toast({ title: "レース情報同期ジョブを作成しました" });
      setSyncDate("");
    },
    onError: () => toast({ title: "同期ジョブの作成に失敗しました", variant: "destructive" }),
  });

  const handleCreateSync = () => {
    if (!syncDate) return;
    createSyncMutation.mutate(syncDate.replace(/-/g, ""));
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">処理管理</h1>
        </div>

        <Tabs defaultValue="batch">
          <TabsList className="mb-4">
            <TabsTrigger value="batch">バッチジョブ</TabsTrigger>
            <TabsTrigger value="sync">レース情報同期</TabsTrigger>
          </TabsList>

          {/* Batch Jobs Tab */}
          <TabsContent value="batch">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">バッチジョブ一覧</h2>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 cursor-pointer"
                onClick={() => refetchBatch()}
              >
                <RefreshCcw className="h-3.5 w-3.5" />更新
              </Button>
            </div>

            {batchLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="border border-zinc-800 rounded-lg h-12 bg-zinc-900/40 animate-pulse" />
                ))}
              </div>
            ) : batchJobs.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 text-sm">
                バッチジョブが見つかりません
              </div>
            ) : (
              <div className="space-y-2">
                {batchJobs.map((job) => (
                  <BatchJobRow
                    key={job.id}
                    job={job}
                    onRun={(id) => runJobMutation.mutate(id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Sync Jobs Tab */}
          <TabsContent value="sync">
            <div className="mb-4 p-4 bg-zinc-900/60 border border-zinc-800 rounded-lg">
              <h2 className="text-sm font-medium mb-3">レース情報同期ジョブ作成</h2>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={syncDate}
                  onChange={(e) => setSyncDate(e.target.value)}
                  className="h-8 w-48 text-sm bg-zinc-900 border-zinc-700"
                  placeholder="対象日を選択"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs cursor-pointer"
                  onClick={handleCreateSync}
                  disabled={!syncDate || createSyncMutation.isPending}
                >
                  同期ジョブを作成
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">同期ジョブ履歴</h2>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 cursor-pointer"
                onClick={() => refetchSync()}
              >
                <RefreshCcw className="h-3.5 w-3.5" />更新
              </Button>
            </div>

            {syncLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border border-zinc-800 rounded-lg h-10 bg-zinc-900/40 animate-pulse" />
                ))}
              </div>
            ) : syncJobs.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 text-sm">
                同期ジョブがありません
              </div>
            ) : (
              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-900/60">
                    <tr>
                      <th className="px-4 py-2 text-left text-muted-foreground">対象日</th>
                      <th className="px-4 py-2 text-left text-muted-foreground">ステータス</th>
                      <th className="px-4 py-2 text-left text-muted-foreground">開始時刻</th>
                      <th className="px-4 py-2 text-left text-muted-foreground">完了時刻</th>
                      <th className="px-4 py-2 text-left text-muted-foreground">実行者</th>
                      <th className="px-4 py-2 text-left text-muted-foreground">エラー</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncJobs.map((job) => (
                      <tr key={job.syncJobId} className="border-t border-zinc-800 hover:bg-zinc-900/30">
                        <td className="px-4 py-2 font-mono text-foreground">{job.holdingDate}</td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(job.status)}`}>
                            {statusLabel(job.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{formatTime(job.startedAt)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{formatTime(job.completedAt)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{job.triggeredBy || "-"}</td>
                        <td className="px-4 py-2">
                          {job.errorMessage && (
                            <span className="text-red-400 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />{job.errorMessage}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
