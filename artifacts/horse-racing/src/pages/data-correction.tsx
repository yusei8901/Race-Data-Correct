import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "wouter";
import { 
  ArrowLeft, 
  Play, 
  CheckCircle2, 
  RefreshCw, 
  Save, 
  AlertCircle,
  Video
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetRace, 
  getGetRaceQueryKey,
  useGetRaceEntries,
  getGetRaceEntriesQueryKey,
  useGetPassingOrders,
  getGetPassingOrdersQueryKey,
  useStartCorrection,
  useCompleteCorrection,
  useReanalyzeRace,
  useUpdatePassingOrder
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";

function getStatusBadgeProps(status?: string) {
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

// Map color strings to tailwind classes
const horseColorMap: Record<string, string> = {
  "白": "bg-white text-black border-gray-300",
  "黒": "bg-gray-900 text-white border-gray-700",
  "赤": "bg-red-600 text-white border-red-800",
  "青": "bg-blue-600 text-white border-blue-800",
  "黄": "bg-yellow-400 text-black border-yellow-600",
  "緑": "bg-green-600 text-white border-green-800",
  "橙": "bg-orange-500 text-black border-orange-700",
  "桃": "bg-pink-400 text-black border-pink-600",
};

export default function DataCorrection() {
  const params = useParams();
  const raceId = params.raceId as string;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeCheckpoint, setActiveCheckpoint] = useState<string>("all");

  const { data: race, isLoading: isRaceLoading } = useGetRace(raceId, {
    query: { enabled: !!raceId, queryKey: getGetRaceQueryKey(raceId) }
  });

  const { data: entries, isLoading: isEntriesLoading } = useGetRaceEntries(raceId, {
    query: { enabled: !!raceId, queryKey: getGetRaceEntriesQueryKey(raceId) }
  });

  const { data: passingOrders, isLoading: isOrdersLoading } = useGetPassingOrders(
    raceId, 
    { checkpoint: activeCheckpoint !== "all" ? activeCheckpoint : undefined },
    { query: { enabled: !!raceId, queryKey: getGetPassingOrdersQueryKey(raceId, { checkpoint: activeCheckpoint !== "all" ? activeCheckpoint : undefined }) } }
  );

  const startCorrection = useStartCorrection();
  const completeCorrection = useCompleteCorrection();
  const reanalyzeRace = useReanalyzeRace();
  const updatePassingOrder = useUpdatePassingOrder();

  const handleStartCorrection = () => {
    startCorrection.mutate({ raceId }, {
      onSuccess: (updatedRace) => {
        toast({ title: "補正を開始しました" });
        queryClient.setQueryData(getGetRaceQueryKey(raceId), updatedRace);
      },
      onError: () => {
        toast({ title: "エラーが発生しました", variant: "destructive" });
      }
    });
  };

  const handleCompleteCorrection = () => {
    completeCorrection.mutate({ raceId }, {
      onSuccess: (updatedRace) => {
        toast({ title: "補正を完了しました" });
        queryClient.setQueryData(getGetRaceQueryKey(raceId), updatedRace);
      },
      onError: () => {
        toast({ title: "エラーが発生しました", variant: "destructive" });
      }
    });
  };

  const handleReanalyze = () => {
    reanalyzeRace.mutate({ raceId }, {
      onSuccess: () => {
        toast({ title: "再解析をリクエストしました" });
      },
      onError: () => {
        toast({ title: "エラーが発生しました", variant: "destructive" });
      }
    });
  };

  const badgeProps = getStatusBadgeProps(race?.status);
  const isTurf = race?.surface_type === "芝";

  // Get unique checkpoints for tabs
  const allCheckpoints = useMemo(() => {
    if (!passingOrders) return [];
    const points = new Set<string>();
    passingOrders.forEach(o => points.add(o.checkpoint));
    return Array.from(points).sort((a, b) => {
      // Try to sort numerically if possible (e.g. "200m" -> 200)
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [passingOrders]);

  useEffect(() => {
    if (allCheckpoints.length > 0 && activeCheckpoint === "all" && !isOrdersLoading) {
      // setActiveCheckpoint(allCheckpoints[0]); // Optional: default to first
    }
  }, [allCheckpoints, activeCheckpoint, isOrdersLoading]);

  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEditStart = (id: string, currentVal: number) => {
    setEditingPositionId(id);
    setEditValue(currentVal.toString());
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleEditSave = useCallback((id: string) => {
    if (!editValue || isNaN(parseInt(editValue))) {
      setEditingPositionId(null);
      return;
    }
    
    const newPos = parseInt(editValue);
    
    updatePassingOrder.mutate({ 
      id, 
      data: { position: newPos } 
    }, {
      onSuccess: (updatedOrder) => {
        toast({ title: "順位を更新しました" });
        queryClient.invalidateQueries({ queryKey: getGetPassingOrdersQueryKey(raceId) });
      },
      onError: () => {
        toast({ title: "更新に失敗しました", variant: "destructive" });
      },
      onSettled: () => {
        setEditingPositionId(null);
      }
    });
  }, [editValue, raceId, updatePassingOrder, queryClient, toast]);

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter") {
      handleEditSave(id);
    } else if (e.key === "Escape") {
      setEditingPositionId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          {isRaceLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : race && (
            <div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={`text-xs font-normal border ${badgeProps.className}`}>
                  {badgeProps.label}
                </Badge>
                <h1 className="text-xl font-bold text-foreground">
                  {race.venue} {race.race_number}R {race.race_name}
                </h1>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1.5">
                <span className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${isTurf ? "bg-green-500" : "bg-amber-700"}`}></span>
                  {race.surface_type}{race.distance}m ({race.direction || "-"})
                </span>
                <span>•</span>
                <span>{race.weather || "天候不明"} / {race.condition || "馬場不明"}</span>
                <span>•</span>
                <span>発走 {race.start_time?.substring(0, 5) || "-"}</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {race?.video_status === "available" && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-card">
              <Video className="h-3.5 w-3.5" />
              映像確認
            </Button>
          )}
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 gap-1.5"
            onClick={handleReanalyze}
            disabled={reanalyzeRace.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reanalyzeRace.isPending ? "animate-spin" : ""}`} />
            再解析
          </Button>
          
          {race?.status === "未処理" || race?.status === "修正要求" ? (
            <Button 
              size="sm" 
              className="h-8 gap-1.5"
              onClick={handleStartCorrection}
              disabled={startCorrection.isPending}
            >
              <Play className="h-3.5 w-3.5" />
              補正開始
            </Button>
          ) : race?.status === "補正中" || race?.status === "データ補正" ? (
            <Button 
              size="sm" 
              className="h-8 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              onClick={handleCompleteCorrection}
              disabled={completeCorrection.isPending}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              補正完了
            </Button>
          ) : null}
        </div>
      </div>

      {/* Main Content Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left pane: Official Data */}
        <div className="w-1/3 min-w-[300px] border-r border-border bg-card/50 flex flex-col">
          <div className="p-3 border-b border-border bg-card font-medium text-sm flex justify-between items-center">
            <span>出馬表・公式データ</span>
            <Badge variant="outline" className="text-[10px] bg-secondary/50">JRA公式</Badge>
          </div>
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur">
                <TableRow>
                  <TableHead className="w-[40px] text-center p-2 text-xs">枠</TableHead>
                  <TableHead className="w-[40px] text-center p-2 text-xs">馬</TableHead>
                  <TableHead className="p-2 text-xs">馬名 / 騎手</TableHead>
                  <TableHead className="w-[60px] text-right p-2 text-xs">着順</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isEntriesLoading ? (
                  Array.from({ length: 18 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="p-2"><Skeleton className="h-5 w-5 mx-auto" /></TableCell>
                      <TableCell className="p-2"><Skeleton className="h-5 w-5 mx-auto" /></TableCell>
                      <TableCell className="p-2"><Skeleton className="h-5 w-24" /><Skeleton className="h-3 w-16 mt-1" /></TableCell>
                      <TableCell className="p-2"><Skeleton className="h-5 w-5 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : (
                  entries?.sort((a, b) => a.horse_number - b.horse_number).map((entry) => {
                    const colorClass = entry.color && horseColorMap[entry.color] ? horseColorMap[entry.color] : "bg-muted border-border";
                    return (
                      <TableRow key={entry.id} className="hover:bg-muted/30">
                        <TableCell className="p-2 text-center">
                          <div className={`w-5 h-5 mx-auto border flex items-center justify-center text-xs font-bold ${colorClass}`}>
                            {entry.gate_number}
                          </div>
                        </TableCell>
                        <TableCell className="p-2 text-center font-mono text-sm">{entry.horse_number}</TableCell>
                        <TableCell className="p-2">
                          <div className="font-bold text-sm">{entry.horse_name}</div>
                          <div className="text-[10px] text-muted-foreground">{entry.jockey_name}</div>
                        </TableCell>
                        <TableCell className="p-2 text-right font-mono font-bold text-sm">
                          {entry.finish_position || "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Right pane: Passing Orders */}
        <div className="flex-1 flex flex-col bg-background">
          <div className="p-3 border-b border-border bg-card font-medium text-sm flex justify-between items-center">
            <span>通過順位データ</span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3 text-yellow-500" /> 補正済み</span>
            </div>
          </div>
          
          <div className="border-b border-border bg-muted/20 p-2">
            <Tabs value={activeCheckpoint} onValueChange={setActiveCheckpoint}>
              <TabsList className="h-8 w-full justify-start overflow-x-auto bg-transparent p-0 gap-1 rounded-none border-b-0 hide-scrollbar">
                <TabsTrigger 
                  value="all" 
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground h-8 text-xs rounded border border-transparent data-[state=inactive]:border-border data-[state=inactive]:bg-card"
                >
                  すべて
                </TabsTrigger>
                {allCheckpoints.map(cp => (
                  <TabsTrigger 
                    key={cp} 
                    value={cp}
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground h-8 text-xs rounded border border-transparent data-[state=inactive]:border-border data-[state=inactive]:bg-card"
                  >
                    {cp}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="bg-card sticky top-0 z-10 shadow-sm">
                <TableRow>
                  {activeCheckpoint === "all" && <TableHead className="w-[80px] p-2 text-xs">地点</TableHead>}
                  <TableHead className="w-[50px] text-center p-2 text-xs">馬</TableHead>
                  <TableHead className="p-2 text-xs">馬名</TableHead>
                  <TableHead className="w-[80px] text-right p-2 text-xs">レーン</TableHead>
                  <TableHead className="w-[80px] text-right p-2 text-xs">タイム</TableHead>
                  <TableHead className="w-[80px] text-right p-2 text-xs">確信度</TableHead>
                  <TableHead className="w-[100px] text-center p-2 text-xs bg-muted/30">順位</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isOrdersLoading ? (
                  Array.from({ length: 15 }).map((_, i) => (
                    <TableRow key={i}>
                      {activeCheckpoint === "all" && <TableCell className="p-2"><Skeleton className="h-5 w-10" /></TableCell>}
                      <TableCell className="p-2"><Skeleton className="h-5 w-5 mx-auto" /></TableCell>
                      <TableCell className="p-2"><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell className="p-2"><Skeleton className="h-5 w-10 ml-auto" /></TableCell>
                      <TableCell className="p-2"><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                      <TableCell className="p-2"><Skeleton className="h-5 w-10 ml-auto" /></TableCell>
                      <TableCell className="p-2"><Skeleton className="h-7 w-12 mx-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : passingOrders?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={activeCheckpoint === "all" ? 7 : 6} className="h-32 text-center text-muted-foreground">
                      データがありません
                    </TableCell>
                  </TableRow>
                ) : (
                  passingOrders?.sort((a, b) => {
                    if (a.checkpoint !== b.checkpoint) return a.checkpoint.localeCompare(b.checkpoint);
                    return a.position - b.position;
                  }).map((order) => {
                    const isEditing = editingPositionId === order.id;
                    const accuracyColor = order.accuracy && order.accuracy > 80 
                      ? "text-green-500" 
                      : order.accuracy && order.accuracy > 50 
                        ? "text-yellow-500" 
                        : "text-red-500";

                    return (
                      <TableRow key={order.id} className="hover:bg-muted/40 transition-colors">
                        {activeCheckpoint === "all" && (
                          <TableCell className="p-2 text-xs font-mono font-medium">{order.checkpoint}</TableCell>
                        )}
                        <TableCell className="p-2 text-center font-mono text-sm">{order.horse_number}</TableCell>
                        <TableCell className="p-2 text-sm font-medium">{order.horse_name}</TableCell>
                        <TableCell className="p-2 text-right text-xs text-muted-foreground font-mono">{order.lane || "-"}</TableCell>
                        <TableCell className="p-2 text-right text-xs font-mono">{order.time_seconds ? order.time_seconds.toFixed(2) : "-"}</TableCell>
                        <TableCell className="p-2 text-right text-xs font-mono">
                          <span className={accuracyColor}>
                            {order.accuracy != null ? `${order.accuracy}%` : "-"}
                          </span>
                        </TableCell>
                        <TableCell className="p-2 text-center bg-muted/10 border-l border-border/50">
                          {isEditing ? (
                            <div className="flex items-center justify-center gap-1">
                              <Input
                                ref={inputRef}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, order.id)}
                                onBlur={() => handleEditSave(order.id)}
                                className="w-12 h-7 text-center px-1 py-0 text-sm font-mono focus-visible:ring-1 bg-background"
                              />
                            </div>
                          ) : (
                            <div 
                              className={`
                                cursor-text mx-auto w-12 py-1 rounded text-sm font-mono font-bold
                                hover:bg-secondary border border-transparent hover:border-border transition-colors
                                ${order.is_corrected ? "text-yellow-500 bg-yellow-500/10" : "text-foreground"}
                              `}
                              onClick={() => handleEditStart(order.id, order.position)}
                              title="クリックして編集"
                            >
                              {order.position}
                            </div>
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
    </div>
  );
}
