import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PDFViewer } from "@react-pdf/renderer";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Printer,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { compareTiNumberValues, useGetTiRecord, useListTiRecords } from "@/api-client";
import { SearchModal } from "@/components/ti-form/SearchModal";
import { TiPdfDocument } from "@/components/ti-form/TiPdf";
import { downloadTiPdf, printTiPdf } from "@/components/ti-form/downloadTiPdf";
import type { ApprovalStatus, UserProfile } from "@/api-client";
import { ProfileTopBar } from "@/components/ProfileTopBar";

export default function Viewer({
  profile,
  onLogout,
  onBackToModules,
}: {
  profile: UserProfile;
  onLogout: () => void | Promise<void>;
  onBackToModules?: () => void;
}) {
  const { toast } = useToast();
  const [currentTiNo, setCurrentTiNo] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(true);
  const { data: checkedRecordsData } = useListTiRecords(
    { approvalStatus: "checked" },
    { query: { enabled: true } }
  );

  const { data: record, isLoading } = useGetTiRecord(currentTiNo, {
    query: { enabled: !!currentTiNo, retry: false },
  });
  const sortedCheckedRecords = useMemo(
    () => [...(checkedRecordsData?.records || [])].sort((a, b) => compareTiNumberValues(a.ti_no, b.ti_no)),
    [checkedRecordsData?.records]
  );
  const adjacent = useMemo(() => {
    if (!currentTiNo) return { prev: null, next: null };
    const currentIndex = sortedCheckedRecords.findIndex((entry) => entry.ti_no === currentTiNo);
    if (currentIndex === -1) return { prev: null, next: null };
    return {
      prev: currentIndex > 0 ? sortedCheckedRecords[currentIndex - 1].ti_no : null,
      next: currentIndex < sortedCheckedRecords.length - 1 ? sortedCheckedRecords[currentIndex + 1].ti_no : null,
    };
  }, [currentTiNo, sortedCheckedRecords]);

  useEffect(() => {
    if (!record) return;
    if ((record.approval_status || "pending_check") === "checked") return;
    setCurrentTiNo("");
    setIsSearchOpen(true);
    toast({
      variant: "destructive",
      title: "Viewer access limited",
      description: "Viewer role can only open checked TIs.",
    });
  }, [record, toast]);

  const handlePrevious = () => {
    if (adjacent?.prev) setCurrentTiNo(adjacent.prev);
    else toast({ title: "No previous record" });
  };

  const handleNext = () => {
    if (adjacent?.next) setCurrentTiNo(adjacent.next);
    else toast({ title: "No next record" });
  };

  const handleDownload = async () => {
    if (!record) return;
    if (record.approval_status !== "checked") {
      toast({ variant: "destructive", title: "TI is not checked", description: "PDF is available only after checking." });
      return;
    }
    try {
      await downloadTiPdf(record);
    } catch (error) {
      toast({ variant: "destructive", title: "PDF failed", description: String(error) });
    }
  };

  const handlePrint = async () => {
    if (!record) return;
    if (record.approval_status !== "checked") {
      toast({ variant: "destructive", title: "TI is not checked", description: "Print is available only after checking." });
      return;
    }
    try {
      await printTiPdf(record);
    } catch (error) {
      toast({ variant: "destructive", title: "Print failed", description: String(error) });
    }
  };

  const openSearch = () => {
    setIsSearchOpen(true);
  };

  const hideTopBar = isSearchOpen;

  return (
    <div className="min-h-screen bg-[#dfe4ea]">
      <aside className="w-[60px] bg-[#2a4080] flex flex-col items-center py-4 space-y-4 no-print shrink-0 fixed h-full z-10">
        <ViewerSidebarButton icon={<Search />} title="Search" onClick={openSearch} />
        <ViewerSidebarButton icon={<ChevronLeft />} title="Prev" onClick={handlePrevious} disabled={!record} />
        <ViewerSidebarButton icon={<ChevronRight />} title="Next" onClick={handleNext} disabled={!record} />
        <ViewerSidebarButton icon={<Printer />} title="Print" onClick={handlePrint} disabled={!record || record.approval_status !== "checked"} />
        <ViewerSidebarButton icon={<FileText />} title="PDF" onClick={handleDownload} disabled={!record || record.approval_status !== "checked"} />
        <div className="flex-1" />
      </aside>
      <main className="ml-[60px] min-w-0">
        {!hideTopBar && (
          <ProfileTopBar
            profile={profile}
            onLogout={onLogout}
            title="CT TI Viewer"
            onModulesClick={onBackToModules}
            rejectedCount={0}
          />
        )}
        <div className="px-4 py-4 md:px-6 md:py-6">
        {record ? (
          <div className="h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] max-w-5xl mx-auto border border-gray-400 shadow-xl bg-white">
            <PDFViewer
              key={record.ti_no}
              width="100%"
              height="100%"
              showToolbar={false}
              className="border-0"
            >
              <TiPdfDocument data={record} />
            </PDFViewer>
          </div>
        ) : (
          <div className="h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] max-w-5xl mx-auto bg-white border border-gray-300 flex items-center justify-center">
            <div className="text-center px-6">
              <Search className="w-10 h-10 text-[#2a4080] mx-auto mb-4" />
              <h2 className="text-lg font-bold text-gray-900">
                {isLoading ? "Loading TI..." : "Select a TI to view"}
              </h2>
              <p className="mt-1 text-sm text-gray-500">{profile.full_name} ({profile.role})</p>
              {!isLoading && (
                <Button className="mt-5 bg-[#2a4080]" onClick={openSearch}>
                  <Search className="w-4 h-4 mr-2" /> Search TI Records
                </Button>
              )}
            </div>
          </div>
        )}
        </div>
      </main>

      <SearchModal
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        statusFilter="checked"
        onSelect={(tiNo) => {
          setCurrentTiNo(tiNo);
          setIsSearchOpen(false);
        }}
      />
    </div>
  );
}

function ViewerSidebarButton({
  icon,
  title,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`w-12 h-12 flex flex-col items-center justify-center rounded-md transition-colors group ${
        disabled
          ? "text-white/30 cursor-not-allowed"
          : "text-white/80 hover:text-white hover:bg-white/10"
      }`}
    >
      <span className={`mb-1 [&>svg]:h-5 [&>svg]:w-5 transition-transform ${!disabled ? "group-hover:scale-110" : ""}`}>
        {icon}
      </span>
      <span className="text-[10px] font-medium">{title}</span>
    </button>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
