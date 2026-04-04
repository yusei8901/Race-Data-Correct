import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Settings2, Plus, Trash2, Save, Pencil } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { 
  useGetBatchJobs,
  getGetBatchJobsQueryKey,
  useToggleBatchJob,
  useDeleteBatchJob,
  useCreateBatchJob,
  useUpdateBatchJob,
  useGetVenues,
  getGetVenuesQueryKey,
  useGetAnalysisParams,
  getGetAnalysisParamsQueryKey,
  useUpdateAnalysisParams
} from "@workspace/api-client-react";
import type { BatchJob } from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const batchJobSchema = z.object({
  name: z.string().min(1, "ジョブ名は必須です"),
  cron_expression: z.string().min(1, "クーロン式は必須です"),
  is_enabled: z.boolean().default(true),
});

const editJobSchema = z.object({
  name: z.string().min(1, "ジョブ名は必須です"),
  cron_expression: z.string().min(1, "クーロン式は必須です"),
});

export default function ProcessingManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<BatchJob | null>(null);
  const [selectedVenueId, setSelectedVenueId] = useState<string>("");

  const { data: jobs, isLoading: isJobsLoading } = useGetBatchJobs({
    query: { queryKey: getGetBatchJobsQueryKey() }
  });

  const { data: venues, isLoading: isVenuesLoading } = useGetVenues({
    query: { queryKey: getGetVenuesQueryKey() }
  });

  const { data: paramsData, isLoading: isParamsLoading } = useGetAnalysisParams(
    selectedVenueId,
    { query: { enabled: !!selectedVenueId, queryKey: getGetAnalysisParamsQueryKey(selectedVenueId) } }
  );

  useEffect(() => {
    if (venues && venues.length > 0 && !selectedVenueId) {
      setSelectedVenueId(venues[0].id);
    }
  }, [venues, selectedVenueId]);

  const toggleJob = useToggleBatchJob();
  const deleteJob = useDeleteBatchJob();
  const createJob = useCreateBatchJob();
  const updateJob = useUpdateBatchJob();
  const updateParams = useUpdateAnalysisParams();

  const form = useForm<z.infer<typeof batchJobSchema>>({
    resolver: zodResolver(batchJobSchema),
    defaultValues: {
      name: "",
      cron_expression: "0 0 * * *",
      is_enabled: true,
    },
  });

  const onSubmit = (values: z.infer<typeof batchJobSchema>) => {
    createJob.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "バッチジョブを作成しました" });
        setIsCreateOpen(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: getGetBatchJobsQueryKey() });
      },
      onError: () => {
        toast({ title: "エラーが発生しました", variant: "destructive" });
      }
    });
  };

  const handleToggle = (id: string, currentEnabled: boolean) => {
    toggleJob.mutate({ id }, {
      onSuccess: () => {
        toast({ title: `ジョブを${currentEnabled ? "無効化" : "有効化"}しました` });
        queryClient.invalidateQueries({ queryKey: getGetBatchJobsQueryKey() });
      }
    });
  };

  const editForm = useForm<z.infer<typeof editJobSchema>>({
    resolver: zodResolver(editJobSchema),
    defaultValues: { name: "", cron_expression: "" },
  });

  const handleOpenEdit = (job: BatchJob) => {
    setEditingJob(job);
    editForm.reset({ name: job.name, cron_expression: job.cron_expression });
  };

  const handleEditSubmit = (values: z.infer<typeof editJobSchema>) => {
    if (!editingJob) return;
    updateJob.mutate({ id: editingJob.id, data: values }, {
      onSuccess: () => {
        toast({ title: "バッチジョブを更新しました" });
        setEditingJob(null);
        queryClient.invalidateQueries({ queryKey: getGetBatchJobsQueryKey() });
      },
      onError: () => {
        toast({ title: "更新に失敗しました", variant: "destructive" });
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

  const [paramsJson, setParamsJson] = useState("");
  
  useEffect(() => {
    if (paramsData) {
      setParamsJson(JSON.stringify(paramsData.params, null, 2));
    }
  }, [paramsData]);

  const handleSaveParams = () => {
    if (!selectedVenueId) return;
    
    try {
      const parsed = JSON.parse(paramsJson);
      updateParams.mutate({ venueId: selectedVenueId, data: { params: parsed } }, {
        onSuccess: () => {
          toast({ title: "解析パラメータを更新しました" });
          queryClient.invalidateQueries({ queryKey: getGetAnalysisParamsQueryKey(selectedVenueId) });
        },
        onError: () => {
          toast({ title: "パラメータの保存に失敗しました", variant: "destructive" });
        }
      });
    } catch (e) {
      toast({ title: "無効なJSONフォーマットです", variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col h-full bg-background p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">処理管理</h1>
        <p className="text-sm text-muted-foreground mt-1">システムの自動処理と解析エンジンの設定</p>
      </div>

      <Tabs defaultValue="batch" className="flex-1 flex flex-col h-full overflow-hidden">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent h-12 p-0">
          <TabsTrigger 
            value="batch" 
            className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-6 h-full font-medium"
          >
            バッチ管理
          </TabsTrigger>
          <TabsTrigger 
            value="analysis" 
            className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-6 h-full font-medium"
          >
            解析ツール管理
          </TabsTrigger>
        </TabsList>

        <TabsContent value="batch" className="flex-1 mt-6 overflow-hidden flex flex-col focus-visible:outline-none">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">登録済みバッチジョブ</h2>
            
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  新規ジョブ
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>バッチジョブ作成</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ジョブ名</FormLabel>
                          <FormControl>
                            <Input placeholder="例: Daily Data Fetch" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="cron_expression"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>クーロン式</FormLabel>
                          <FormControl>
                            <Input placeholder="0 0 * * *" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="is_enabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-3">
                          <div className="space-y-0.5">
                            <FormLabel>初期状態</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <DialogFooter className="mt-6">
                      <Button type="submit" disabled={createJob.isPending}>作成</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="rounded-md border border-border bg-card flex-1 overflow-auto">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0">
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>ジョブ名</TableHead>
                  <TableHead className="w-[150px]">スケジュール</TableHead>
                  <TableHead className="w-[120px]">状態</TableHead>
                  <TableHead className="w-[180px]">次回実行</TableHead>
                  <TableHead className="w-[100px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isJobsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-8" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : jobs?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      バッチジョブが登録されていません
                    </TableCell>
                  </TableRow>
                ) : (
                  jobs?.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Switch 
                          checked={job.is_enabled} 
                          onCheckedChange={() => handleToggle(job.id, job.is_enabled)}
                          disabled={toggleJob.isPending}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{job.name}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{job.cron_expression}</TableCell>
                      <TableCell>
                        <Badge variant={job.status === "実行中" ? "default" : job.status === "有効" ? "outline" : "secondary"}
                               className={job.status === "実行中" ? "bg-blue-600 hover:bg-blue-600" : job.status === "有効" ? "text-green-500 border-green-800 bg-green-950/20" : ""}>
                          {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{job.next_run_at || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleOpenEdit(job)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDelete(job.id)}
                            disabled={deleteJob.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="analysis" className="flex-1 mt-6 overflow-hidden flex flex-col focus-visible:outline-none">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-full">
            <Card className="md:col-span-1 bg-card h-fit">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-primary" />
                  会場選択
                </CardTitle>
                <CardDescription>解析パラメータを設定する会場</CardDescription>
              </CardHeader>
              <CardContent>
                {isVenuesLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <div className="space-y-1">
                    {venues?.map(v => (
                      <button
                        key={v.id}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          selectedVenueId === v.id 
                            ? "bg-primary/20 text-primary font-medium" 
                            : "hover:bg-muted text-foreground"
                        }`}
                        onClick={() => setSelectedVenueId(v.id)}
                      >
                        {v.name} <span className="text-xs text-muted-foreground ml-2">{v.race_type}</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-3 bg-card flex flex-col h-full min-h-[400px]">
              <CardHeader className="pb-3 border-b border-border/50">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-base">解析パラメータ (JSON)</CardTitle>
                    <CardDescription>
                      {paramsData ? `${paramsData.venue_name}の設定` : "会場を選択してください"}
                    </CardDescription>
                  </div>
                  {paramsData && (
                    <Badge variant="outline" className="font-mono text-xs">
                      最終更新: {paramsData.updated_at ? new Date(paramsData.updated_at).toLocaleDateString() : "-"}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-0">
                {isParamsLoading ? (
                  <div className="p-4 h-full"><Skeleton className="h-full w-full" /></div>
                ) : !selectedVenueId ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    左側のリストから会場を選択してください
                  </div>
                ) : (
                  <Textarea 
                    className="h-full min-h-[300px] w-full rounded-none border-0 font-mono text-sm p-4 bg-muted/10 resize-none focus-visible:ring-0"
                    value={paramsJson}
                    onChange={(e) => setParamsJson(e.target.value)}
                    spellCheck={false}
                  />
                )}
              </CardContent>
              <CardFooter className="border-t border-border/50 pt-4 flex justify-end">
                <Button 
                  className="gap-2" 
                  onClick={handleSaveParams}
                  disabled={!selectedVenueId || updateParams.isPending}
                >
                  <Save className="h-4 w-4" />
                  保存
                </Button>
              </CardFooter>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editingJob} onOpenChange={(open) => !open && setEditingJob(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>バッチジョブ編集</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="space-y-4 mt-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ジョブ名</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="cron_expression"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>クーロン式</FormLabel>
                    <FormControl>
                      <Input placeholder="0 0 * * *" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setEditingJob(null)}>キャンセル</Button>
                <Button type="submit" disabled={updateJob.isPending}>更新</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
