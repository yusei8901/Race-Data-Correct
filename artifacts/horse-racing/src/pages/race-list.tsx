import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Search, Filter, RefreshCcw } from "lucide-react";
import { 
  useGetRaces, 
  getGetRacesQueryKey,
  useGetRaceSummary,
  getGetRaceSummaryQueryKey
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function getStatusBadgeProps(status: string) {
  switch (status) {
    case "未処理": return { className: "bg-muted text-muted-foreground border-muted-border", label: "未処理" };
    case "補正中": return { className: "bg-blue-900/40 text-blue-400 border-blue-800", label: "補正中" };
    case "データ補正": return { className: "bg-yellow-900/40 text-yellow-400 border-yellow-800", label: "データ補正" };
    case "補正完了": return { className: "bg-green-900/40 text-green-400 border-green-800", label: "補正完了" };
    case "修正要求": return { className: "bg-red-900/40 text-red-400 border-red-800", label: "修正要求" };
    case "レビュー": return { className: "bg-purple-900/40 text-purple-400 border-purple-800", label: "レビュー" };
    default: return { className: "bg-muted text-muted-foreground border-muted-border", label: status || "不明" };
  }
}

export default function RaceList() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [venue, setVenue] = useState<string>("all");
  
  const { data: races, isLoading: isRacesLoading } = useGetRaces(
    { date, venue: venue !== "all" ? venue : undefined },
    { query: { enabled: true, queryKey: getGetRacesQueryKey({ date, venue: venue !== "all" ? venue : undefined }) } }
  );

  const { data: summary, isLoading: isSummaryLoading } = useGetRaceSummary(
    { date },
    { query: { enabled: true, queryKey: getGetRaceSummaryQueryKey({ date }) } }
  );

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b border-border bg-card p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">レース一覧</h1>
          <p className="text-xs text-muted-foreground mt-1">処理対象のレースデータ一覧と状況サマリー</p>
        </div>
        <div className="flex items-center gap-2">
          <Input 
            type="date" 
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-[150px] h-9 text-sm"
          />
          <Select value={venue} onValueChange={setVenue}>
            <SelectTrigger className="w-[150px] h-9 text-sm">
              <SelectValue placeholder="会場フィルタ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全会場</SelectItem>
              <SelectItem value="東京">東京</SelectItem>
              <SelectItem value="中山">中山</SelectItem>
              <SelectItem value="京都">京都</SelectItem>
              <SelectItem value="阪神">阪神</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-9 w-9">
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-5 gap-4">
        {isSummaryLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[80px] w-full" />)
        ) : (
          <>
            <Card className="bg-card">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">総レース数</div>
                <div className="text-2xl font-bold mt-1">{summary?.total || 0}</div>
              </CardContent>
            </Card>
            <Card className="bg-card">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">完了</div>
                <div className="text-2xl font-bold text-green-500 mt-1">{summary?.completed || 0}</div>
              </CardContent>
            </Card>
            <Card className="bg-card">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">補正中</div>
                <div className="text-2xl font-bold text-blue-500 mt-1">{summary?.in_progress || 0}</div>
              </CardContent>
            </Card>
            <Card className="bg-card">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">レビュー</div>
                <div className="text-2xl font-bold text-purple-500 mt-1">{summary?.review || 0}</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-red-900/50 bg-red-950/10">
              <CardContent className="p-4">
                <div className="text-xs text-red-400">修正要求</div>
                <div className="text-2xl font-bold text-red-500 mt-1">{summary?.needs_correction || 0}</div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="flex-1 p-4 overflow-hidden flex flex-col">
        <div className="rounded-md border border-border bg-card flex-1 overflow-auto">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur">
              <TableRow>
                <TableHead className="w-[80px]">R</TableHead>
                <TableHead className="w-[120px]">会場</TableHead>
                <TableHead>レース名</TableHead>
                <TableHead className="w-[120px]">条件</TableHead>
                <TableHead className="w-[100px]">発走</TableHead>
                <TableHead className="w-[120px]">ステータス</TableHead>
                <TableHead className="w-[120px]">担当</TableHead>
                <TableHead className="w-[100px] text-right">アクション</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isRacesLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-8" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-full max-w-[200px]" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : races?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    該当するレースが見つかりません
                  </TableCell>
                </TableRow>
              ) : (
                races?.map((race) => {
                  const badgeProps = getStatusBadgeProps(race.status);
                  const isTurf = race.surface_type === "芝";
                  
                  return (
                    <TableRow key={race.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium text-xs">{race.race_number}R</TableCell>
                      <TableCell className="text-sm">
                        <span className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded text-xs mr-2">
                          {race.race_type === "中央競馬" ? "中央" : race.race_type === "地方競馬" ? "地方" : "海外"}
                        </span>
                        {race.venue}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{race.race_name}</TableCell>
                      <TableCell className="text-xs flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${isTurf ? "bg-green-500" : "bg-amber-700"}`}></span>
                        {race.surface_type}{race.distance}m
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{race.start_time?.substring(0, 5) || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] font-normal border ${badgeProps.className}`}>
                          {badgeProps.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{race.assigned_user || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/races/${race.id}`}>
                          <Button size="sm" variant="secondary" className="h-7 text-xs">
                            詳細・補正
                          </Button>
                        </Link>
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
