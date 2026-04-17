import { useState, useMemo } from "react";
import {
  ScrollText, Search, ChevronLeft, ChevronRight, X, RefreshCcw, User as UserIcon, Filter,
} from "lucide-react";
import {
  useListAuditLogs,
  useGetAuditLogFilters,
} from "@workspace/api-client-react";
import type { AuditLogEntry } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

const ACTION_BADGE_CLASS: Record<string, string> = {
  STATUS_CHANGE:     "bg-cyan-900/40 text-cyan-200 border-cyan-700/60",
  CONFIRM:           "bg-green-900/40 text-green-200 border-green-700/60",
  REVISION_REJECT:   "bg-red-900/40 text-red-200 border-red-700/60",
  BIND_ANALYSIS:     "bg-blue-900/40 text-blue-200 border-blue-700/60",
  BULK_STATUS:       "bg-purple-900/40 text-purple-200 border-purple-700/60",
  CREATE:            "bg-emerald-900/40 text-emerald-200 border-emerald-700/60",
  UPDATE:            "bg-amber-900/40 text-amber-200 border-amber-700/60",
  DELETE:            "bg-rose-900/40 text-rose-200 border-rose-700/60",
};

function actionBadgeClass(action: string) {
  return ACTION_BADGE_CLASS[action] ?? "bg-zinc-800 text-zinc-300 border-zinc-700";
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}

/** old / new の JSON 差分カラー付き表示 */
function DiffView({ oldVal, newVal }: { oldVal: unknown; newVal: unknown }) {
  // フラット化: トップレベルのキーだけ比較。階層深いものは JSON 文字列扱い。
  const oldObj = (oldVal && typeof oldVal === "object") ? (oldVal as Record<string, unknown>) : null;
  const newObj = (newVal && typeof newVal === "object") ? (newVal as Record<string, unknown>) : null;

  if (!oldObj && !newObj) {
    return <div className="text-xs text-zinc-500 italic">変更内容の詳細はありません</div>;
  }

  const allKeys = Array.from(new Set([
    ...(oldObj ? Object.keys(oldObj) : []),
    ...(newObj ? Object.keys(newObj) : []),
  ]));

  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return "（未設定）";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    try { return JSON.stringify(v); } catch { return String(v); }
  };

  return (
    <div className="space-y-1.5">
      {allKeys.map((key) => {
        const a = oldObj?.[key];
        const b = newObj?.[key];
        const same = JSON.stringify(a) === JSON.stringify(b);
        const onlyOld = oldObj && key in oldObj && (!newObj || !(key in newObj));
        const onlyNew = newObj && key in newObj && (!oldObj || !(key in oldObj));
        return (
          <div key={key} className="grid grid-cols-[120px_1fr_auto_1fr] gap-2 items-start text-xs font-mono">
            <span className="text-zinc-400 truncate" title={key}>{key}</span>
            <div className={`px-2 py-1 rounded border ${
              same ? "bg-zinc-900/60 border-zinc-800 text-zinc-500"
                   : onlyNew ? "bg-zinc-900/40 border-zinc-800 text-zinc-600 italic"
                   : "bg-red-950/40 border-red-900/50 text-red-200"
            } break-all whitespace-pre-wrap`}>
              {onlyNew ? "—" : fmt(a)}
            </div>
            <span className="text-zinc-600 self-center">→</span>
            <div className={`px-2 py-1 rounded border ${
              same ? "bg-zinc-900/60 border-zinc-800 text-zinc-500"
                   : onlyOld ? "bg-zinc-900/40 border-zinc-800 text-zinc-600 italic"
                   : "bg-green-950/40 border-green-900/50 text-green-200"
            } break-all whitespace-pre-wrap`}>
              {onlyOld ? "—" : fmt(b)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [userId, setUserId] = useState<string>("__all__");
  const [action, setAction] = useState<string>("__all__");
  const [targetTable, setTargetTable] = useState<string>("__all__");
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const filterParams = useMemo(() => ({
    from_date: fromDate || undefined,
    to_date: toDate || undefined,
    user_id: userId === "__all__" ? undefined : userId,
    action: action === "__all__" ? undefined : action,
    target_table: targetTable === "__all__" ? undefined : targetTable,
    page,
    page_size: PAGE_SIZE,
  }), [fromDate, toDate, userId, action, targetTable, page]);

  const { data: filterOptions } = useGetAuditLogFilters();
  const { data, isLoading, refetch, isFetching } = useListAuditLogs(filterParams);

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetFilters = () => {
    setFromDate("");
    setToDate("");
    setUserId("__all__");
    setAction("__all__");
    setTargetTable("__all__");
    setPage(1);
  };

  const goPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
  };

  const onFilterChange = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  return (
    <div className="px-6 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-orange-400" />
          <h1 className="text-lg font-semibold text-white tracking-tight">監査ログ</h1>
          {/* <span className="text-xs text-zinc-500 ml-2">
            （いつ・誰が・何を・どう編集したかを記録／6ヶ月で自動削除）
          </span> */}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-8 text-xs border-zinc-700 hover:bg-zinc-800"
        >
          <RefreshCcw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          更新
        </Button>
      </div>

      {/* Filter bar */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 mb-3">
        <div className="flex items-center gap-2 mb-2 text-xs text-zinc-400">
          <Filter className="h-3.5 w-3.5" />
          <span>フィルター</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-2 items-end">
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500 block">開始日</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              className="h-8 text-xs bg-zinc-900 border-zinc-700"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500 block">終了日</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              className="h-8 text-xs bg-zinc-900 border-zinc-700"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500 block">ユーザー</label>
            <Select value={userId} onValueChange={onFilterChange(setUserId)}>
              <SelectTrigger className="h-8 text-xs bg-zinc-900 border-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">すべて</SelectItem>
                {filterOptions?.users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name || u.email || u.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500 block">アクション</label>
            <Select value={action} onValueChange={onFilterChange(setAction)}>
              <SelectTrigger className="h-8 text-xs bg-zinc-900 border-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">すべて</SelectItem>
                {filterOptions?.actions.map((a) => (
                  <SelectItem key={a.code} value={a.code}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500 block">対象</label>
            <Select value={targetTable} onValueChange={onFilterChange(setTargetTable)}>
              <SelectTrigger className="h-8 text-xs bg-zinc-900 border-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">すべて</SelectItem>
                {filterOptions?.target_tables.map((t) => (
                  <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-8 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 w-full"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              リセット
            </Button>
          </div>
        </div>
      </div>

      {/* Result summary + pagination top */}
      <div className="flex items-center justify-between mb-2 text-xs">
        <span className="text-zinc-400">
          {isLoading ? "読み込み中…" : (
            <>
              <span className="text-orange-400 font-semibold">{total.toLocaleString()}</span>
              <span className="ml-1">件中</span>
              <span className="text-white ml-2">
                {total === 0 ? 0 : ((page - 1) * PAGE_SIZE + 1).toLocaleString()}
                {" - "}
                {Math.min(page * PAGE_SIZE, total).toLocaleString()}
              </span>
              <span className="ml-1">件目</span>
            </>
          )}
        </span>
        <Pagination page={page} totalPages={totalPages} onChange={goPage} />
      </div>

      {/* Table */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/30 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-xs text-zinc-400 font-medium w-[160px]">日時</TableHead>
              <TableHead className="text-xs text-zinc-400 font-medium w-[140px]">ユーザー</TableHead>
              <TableHead className="text-xs text-zinc-400 font-medium w-[120px]">アクション</TableHead>
              <TableHead className="text-xs text-zinc-400 font-medium w-[100px]">対象</TableHead>
              <TableHead className="text-xs text-zinc-400 font-medium">対象ID</TableHead>
              <TableHead className="text-xs text-zinc-400 font-medium w-[120px]">IPアドレス</TableHead>
              <TableHead className="text-xs text-zinc-400 font-medium w-[80px] text-center">詳細</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-zinc-500 text-sm">
                  読み込み中…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-zinc-500 text-sm">
                  該当する監査ログがありません
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow
                  key={row.id}
                  className="border-zinc-800/60 hover:bg-zinc-800/40 cursor-pointer"
                  onClick={() => setSelected(row)}
                >
                  <TableCell className="text-xs text-white font-mono whitespace-nowrap">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                  <TableCell className="text-xs text-white">
                    <div className="flex items-center gap-1.5">
                      <UserIcon className="h-3 w-3 text-zinc-500" />
                      <span className="truncate max-w-[120px]" title={row.user_email || undefined}>
                        {row.user_name || row.user_email || "システム"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] font-normal border ${actionBadgeClass(row.action)} whitespace-nowrap`}>
                      {row.action_label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-zinc-300">
                    {row.target_table_label}
                  </TableCell>
                  <TableCell className="text-[11px] text-zinc-500 font-mono truncate max-w-[260px]" title={row.target_id}>
                    {row.target_id}
                  </TableCell>
                  <TableCell className="text-[11px] text-zinc-500 font-mono">
                    {row.ip_address || "-"}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] text-orange-400 hover:text-orange-300 hover:bg-orange-950/40"
                      onClick={(e) => { e.stopPropagation(); setSelected(row); }}
                    >
                      <Search className="h-3 w-3 mr-0.5" />
                      表示
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination bottom */}
      <div className="flex items-center justify-end mt-3">
        <Pagination page={page} totalPages={totalPages} onChange={goPage} />
      </div>

      {/* Detail Modal */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl bg-zinc-950 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-orange-400" />
              監査ログ詳細
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Field label="日時" value={formatDateTime(selected.created_at)} mono />
                <Field
                  label="ユーザー"
                  value={selected.user_name || selected.user_email || "システム"}
                  hint={selected.user_email ?? undefined}
                />
                <Field label="アクション">
                  <Badge variant="outline" className={`text-[10px] font-normal border ${actionBadgeClass(selected.action)}`}>
                    {selected.action_label}
                  </Badge>
                </Field>
                <Field label="対象" value={selected.target_table_label} hint={selected.target_table} />
                <Field label="対象ID" value={selected.target_id} mono />
                <Field label="IPアドレス" value={selected.ip_address || "-"} mono />
              </div>
              <div>
                <div className="text-xs text-zinc-400 font-semibold mb-2 flex items-center gap-2">
                  <span>変更内容</span>
                  <span className="text-[10px] text-zinc-600 font-normal">
                    （赤=変更前、緑=変更後、グレー=変更なし）
                  </span>
                </div>
                <div className="rounded-md bg-zinc-900/60 border border-zinc-800 p-3 max-h-[400px] overflow-y-auto">
                  <DiffView oldVal={selected.old_value} newVal={selected.new_value} />
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub components ──────────────────────────────────────────────────────────────

function Field({
  label, value, children, mono, hint,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[10px] text-zinc-500 mb-0.5">{label}</div>
      <div className={`text-white ${mono ? "font-mono" : ""}`}>
        {children ?? value}
      </div>
      {hint && <div className="text-[10px] text-zinc-600 mt-0.5">{hint}</div>}
    </div>
  );
}

function Pagination({
  page, totalPages, onChange,
}: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) {
    return <div className="text-xs text-zinc-500">1 / 1</div>;
  }

  // 表示するページ番号を最大5個に絞り込む
  const window = 2;
  const pages: number[] = [];
  for (let i = Math.max(1, page - window); i <= Math.min(totalPages, page + window); i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="h-7 px-2 text-xs border-zinc-700 hover:bg-zinc-800 disabled:opacity-40"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      {pages[0] > 1 && (
        <>
          <button
            onClick={() => onChange(1)}
            className="h-7 min-w-[28px] px-2 text-xs rounded text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
          >1</button>
          {pages[0] > 2 && <span className="text-xs text-zinc-600">…</span>}
        </>
      )}
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`h-7 min-w-[28px] px-2 text-xs rounded cursor-pointer transition-colors ${
            p === page
              ? "bg-orange-600/30 border border-orange-500/60 text-orange-200 font-semibold"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800"
          }`}
        >{p}</button>
      ))}
      {pages[pages.length - 1] < totalPages && (
        <>
          {pages[pages.length - 1] < totalPages - 1 && <span className="text-xs text-zinc-600">…</span>}
          <button
            onClick={() => onChange(totalPages)}
            className="h-7 min-w-[28px] px-2 text-xs rounded text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
          >{totalPages}</button>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="h-7 px-2 text-xs border-zinc-700 hover:bg-zinc-800 disabled:opacity-40"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
