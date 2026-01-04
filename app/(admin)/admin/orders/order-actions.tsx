"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MoreHorizontal, CheckCircle2, Eye, Copy, RotateCcw, XCircle, Loader2, Globe } from "lucide-react";
import { adminCompleteOrder, approveRefund, rejectRefund, getClientRefundData, markOrderRefunded } from "@/lib/actions/orders";
import { toast } from "sonner";
import type { RefundMode } from "@/lib/payment/ldc";

interface OrderActionsProps {
  orderId: string;
  orderNo: string;
  status: string;
  refundReason?: string | null;
  refundEnabled?: boolean;
  refundMode?: RefundMode;
}

export function OrderActions({ orderId, orderNo, status, refundReason, refundEnabled = false, refundMode = 'disabled' }: OrderActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const handleComplete = () => {
    if (!confirm("确定要手动完成此订单吗？此操作将发放卡密。")) {
      return;
    }

    startTransition(async () => {
      const result = await adminCompleteOrder(orderId, "管理员手动完成");
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  };

  /**
   * 客户端退款：浏览器直接调用 LDC API
   */
  const handleClientRefund = async (): Promise<boolean> => {
    // 1. 获取退款参数
    const paramsResult = await getClientRefundData(orderId);
    if (!paramsResult.success || !paramsResult.data) {
      toast.error(paramsResult.message);
      return false;
    }

    const { apiUrl, pid, key, trade_no, money } = paramsResult.data;

    // 2. 浏览器直接调用 LDC API
    try {
      toast.info("正在调用支付平台退款接口...");
      
      const formData = new URLSearchParams({
        pid,
        key,
        trade_no,
        money,
      });

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: formData.toString(),
      });

      const text = await response.text();
      
      // 检查是否被 CF 拦截
      if (text.includes("Just a moment") || text.includes("cloudflare")) {
        toast.error("被 Cloudflare 拦截，请先在新标签页打开 credit.linux.do 完成验证后重试");
        // 打开新标签页让用户完成验证
        window.open("https://credit.linux.do", "_blank");
        return false;
      }

      let result;
      try {
        result = JSON.parse(text);
      } catch {
        console.error("退款接口返回非 JSON:", text.substring(0, 500));
        toast.error("支付平台返回格式异常");
        return false;
      }

      if (result.code !== 1) {
        toast.error(`退款失败: ${result.msg || "支付平台返回错误"}`);
        return false;
      }

      // 3. 退款成功，更新订单状态
      const markResult = await markOrderRefunded(orderId, "客户端模式退款成功");
      if (!markResult.success) {
        toast.error(`退款成功，但更新订单状态失败: ${markResult.message}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error("客户端退款失败:", error);
      toast.error("网络请求失败，请检查网络连接");
      return false;
    }
  };

  const handleApproveRefund = () => {
    startTransition(async () => {
      let success = false;
      
      if (refundMode === 'client') {
        // 客户端模式：浏览器直接调用 LDC API
        success = await handleClientRefund();
      } else {
        // 代理模式：服务端调用
        const result = await approveRefund(orderId);
        success = result.success;
        if (!success) {
          toast.error(result.message);
        }
      }
      
      if (success) {
        toast.success("退款成功");
        setRefundDialogOpen(false);
      }
    });
  };

  const handleRejectRefund = () => {
    startTransition(async () => {
      const result = await rejectRefund(orderId, rejectReason || "管理员拒绝退款");
      if (result.success) {
        toast.success(result.message);
        setRejectDialogOpen(false);
        setRejectReason("");
      } else {
        toast.error(result.message);
      }
    });
  };

  const copyOrderNo = () => {
    navigator.clipboard.writeText(orderNo);
    toast.success("订单号已复制");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={isPending}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={copyOrderNo}>
            <Copy className="mr-2 h-4 w-4" />
            复制订单号
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Eye className="mr-2 h-4 w-4" />
            查看详情
          </DropdownMenuItem>
          {(status === "pending" || status === "paid") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleComplete}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                手动完成
              </DropdownMenuItem>
            </>
          )}
          {status === "refund_pending" && refundEnabled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => setRefundDialogOpen(true)}
                className="text-green-600"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                通过退款
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setRejectDialogOpen(true)}
                className="text-red-600"
              >
                <XCircle className="mr-2 h-4 w-4" />
                拒绝退款
              </DropdownMenuItem>
            </>
          )}
          {status === "refund_pending" && !refundEnabled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled className="text-muted-foreground">
                <RotateCcw className="mr-2 h-4 w-4" />
                退款功能未启用
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 通过退款确认对话框 */}
      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              确认通过退款
              {refundMode === 'client' && (
                <span className="inline-flex items-center gap-1 text-xs font-normal bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded-full">
                  <Globe className="h-3 w-3" />
                  客户端模式
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {refundMode === 'client' 
                ? "将通过浏览器直接调用支付平台退款接口（可绕过 CF 验证）"
                : "通过后将调用支付平台退款接口，退还用户积分"
              }
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="font-medium mb-1">退款原因：</p>
              <p className="text-muted-foreground">{refundReason || "未填写"}</p>
            </div>
            {refundMode === 'client' && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium mb-1">⚠️ 客户端模式说明：</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>如遇 CF 验证，请先访问 credit.linux.do 完成验证后重试</li>
                  <li>确保浏览器没有开启广告拦截或隐私模式</li>
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRefundDialogOpen(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button
              onClick={handleApproveRefund}
              disabled={isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              确认退款
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拒绝退款对话框 */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>拒绝退款申请</DialogTitle>
            <DialogDescription>
              请填写拒绝原因（可选）
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="font-medium mb-1">用户退款原因：</p>
              <p className="text-muted-foreground">{refundReason || "未填写"}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reject-reason">拒绝原因</Label>
              <Textarea
                id="reject-reason"
                placeholder="请填写拒绝原因（可选）"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectRefund}
              disabled={isPending}
            >
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

