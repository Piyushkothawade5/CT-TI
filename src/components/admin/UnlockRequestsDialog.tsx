import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useReopenTiRecord,
  useResolveUnlockRequest,
  useUnlockRequests,
  useUnlockTiLabels,
  type UnlockRequest,
} from "@/api-client";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Loader2, Unlock } from "lucide-react";

export function UnlockRequestsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: requests = [], isFetching } = useUnlockRequests({ query: { enabled: open } });
  const reopenTi = useReopenTiRecord();
  const unlockLabels = useUnlockTiLabels();
  const resolveRequest = useResolveUnlockRequest();
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const handleUnlock = async (request: UnlockRequest) => {
    setBusyRequestId(request.id);
    try {
      if (request.request_type === "ti") {
        await reopenTi.mutateAsync({ tiNo: request.ti_no });
      } else {
        await unlockLabels.mutateAsync({ tiNo: request.ti_no });
      }
      // The DB trigger auto-resolves on unlock; call resolve too so the offline
      // (localStorage) path and the queue stay consistent immediately.
      await resolveRequest.mutateAsync({ id: request.id });
      toast({
        title: "Unlocked",
        description: `${request.ti_no} — ${request.request_type === "ti" ? "TI reopened" : "labels unlocked"}.`,
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Unlock failed", description: String(error) });
    } finally {
      setBusyRequestId(null);
    }
  };

  const handleDismiss = async (request: UnlockRequest) => {
    setBusyRequestId(request.id);
    try {
      await resolveRequest.mutateAsync({ id: request.id });
      toast({ title: "Request dismissed", description: `${request.ti_no} unlock request cleared without unlocking.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Dismiss failed", description: String(error) });
    } finally {
      setBusyRequestId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 overflow-hidden border-gray-200 shadow-2xl">
        <DialogHeader className="px-7 py-5 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-orange-50 text-orange-700 flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-xl text-[#20366f]">
                Unlock Requests
                <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 align-middle text-xs font-semibold text-orange-700">
                  {requests.length} pending
                </span>
              </DialogTitle>
              <p className="text-sm text-gray-500 mt-0.5">
                Operators' TI and label unlock requests — unlock straight from here without opening each TI.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto bg-[#f7f9fc] p-6">
          {requests.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-gray-500">
              <KeyRound className="mb-3 h-8 w-8 text-gray-300" />
              {isFetching ? "Loading requests..." : "No pending unlock requests."}
              <p className="mt-1 text-gray-400">A request appears here the moment an operator raises one.</p>
            </div>
          ) : (
            <section className="bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#456da8] text-white">
                    <tr>
                      <th className="text-left px-4 py-3">TI No</th>
                      <th className="text-left px-4 py-3">Type</th>
                      <th className="text-left px-4 py-3">Requested by</th>
                      <th className="text-left px-4 py-3">When</th>
                      <th className="text-left px-4 py-3">Reason</th>
                      <th className="text-left px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {requests.map((request) => {
                      const isBusy = busyRequestId === request.id;
                      return (
                        <tr key={request.id} className="odd:bg-white even:bg-gray-50/40">
                          <td className="px-4 py-3 font-semibold text-[#2a4080]">{request.ti_no}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
                                request.request_type === "ti"
                                  ? "bg-indigo-100 text-indigo-700"
                                  : "bg-teal-100 text-teal-700"
                              }`}
                            >
                              {request.request_type === "ti" ? "TI lock" : "Label lock"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {request.requester?.full_name || request.requester?.initials || "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-500">{formatRequestTime(request.requested_at)}</td>
                          <td className="px-4 py-3 max-w-[240px] text-gray-600">
                            {request.reason ? (
                              <span title={request.reason} className="line-clamp-2">{request.reason}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 min-w-[220px]">
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => handleUnlock(request)}
                                className="bg-[#2a4080] hover:bg-[#1f3164]"
                              >
                                {isBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Unlock className="mr-1 h-3.5 w-3.5" />}
                                Unlock
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isBusy}
                                onClick={() => handleDismiss(request)}
                              >
                                Dismiss
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-200 bg-white">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatRequestTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
