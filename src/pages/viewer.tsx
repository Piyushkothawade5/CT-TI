import { useState } from "react";
import { PDFViewer } from "@react-pdf/renderer";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LogOut,
  Printer,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useGetAdjacentTiRecords, useGetTiRecord } from "@/api-client";
import { SearchModal } from "@/components/ti-form/SearchModal";
import { TiPdfDocument } from "@/components/ti-form/TiPdf";
import { downloadTiPdf, printTiPdf } from "@/components/ti-form/downloadTiPdf";

export default function Viewer({ onLogout }: { onLogout: () => void }) {
  const { toast } = useToast();
  const [currentTiNo, setCurrentTiNo] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(true);

  const { data: record, isLoading } = useGetTiRecord(currentTiNo, {
    query: { enabled: !!currentTiNo, retry: false },
  });
  const { data: adjacent } = useGetAdjacentTiRecords(currentTiNo, {
    query: { enabled: !!currentTiNo },
  });

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
    try {
      await downloadTiPdf(record);
    } catch (error) {
      toast({ variant: "destructive", title: "PDF failed", description: String(error) });
    }
  };

  const handlePrint = async () => {
    if (!record) return;
    try {
      await printTiPdf(record);
    } catch (error) {
      toast({ variant: "destructive", title: "Print failed", description: String(error) });
    }
  };

  return (
    <div className="min-h-screen bg-[#dfe4ea] flex">
      <aside className="w-[60px] bg-[#2a4080] flex flex-col items-center py-4 space-y-4 no-print shrink-0 fixed h-full z-10">
        <ViewerSidebarButton icon={<Search />} title="Search" onClick={() => setIsSearchOpen(true)} />
        <ViewerSidebarButton icon={<ChevronLeft />} title="Prev" onClick={handlePrevious} disabled={!record} />
        <ViewerSidebarButton icon={<ChevronRight />} title="Next" onClick={handleNext} disabled={!record} />
        <ViewerSidebarButton icon={<Printer />} title="Print" onClick={handlePrint} disabled={!record} />
        <ViewerSidebarButton icon={<FileText />} title="PDF" onClick={handleDownload} disabled={!record} />
        <div className="flex-1" />
        <ViewerSidebarButton icon={<LogOut />} title="Role" onClick={onLogout} />
      </aside>

      <main className="ml-[60px] flex-1 min-w-0 p-4 md:p-6">
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
              {!isLoading && (
                <Button className="mt-5 bg-[#2a4080]" onClick={() => setIsSearchOpen(true)}>
                  <Search className="w-4 h-4 mr-2" /> Search TI Records
                </Button>
              )}
            </div>
          </div>
        )}
      </main>

      <SearchModal
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
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
  icon: React.ReactNode;
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
      className={`w-12 h-12 flex flex-col items-center justify-center rounded-md transition-colors group ${
        disabled
          ? "text-white/30 cursor-not-allowed"
          : "text-white/80 hover:text-white hover:bg-white/10"
      }`}
    >
      <span className={`[&>svg]:w-5 [&>svg]:h-5 mb-1 transition-transform ${!disabled ? "group-hover:scale-110" : ""}`}>
        {icon}
      </span>
      <span className="text-[10px] font-medium">{title}</span>
    </button>
  );
}
