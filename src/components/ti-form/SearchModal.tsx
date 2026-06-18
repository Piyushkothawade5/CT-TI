import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useListTiRecords } from "@/api-client";
import { FileText, Eye } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SearchModal({ open, onOpenChange, onSelect }: { open: boolean, onOpenChange: (open: boolean) => void, onSelect: (tiNo: string) => void }) {
  const [filters, setFilters] = useState({
    tiNo: "",
    itemNo: "",
    customer: "",
    woNo: "",
    ctType: ""
  });

  const { data } = useListTiRecords(filters, {
    query: {
      enabled: open,
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2 border-b">
          <DialogTitle className="text-xl text-[#2a4080]">Search TI Records</DialogTitle>
        </DialogHeader>
        
        <div className="p-6 flex-1 overflow-auto bg-gray-50/50">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-gray-500">TI No</Label>
              <Input 
                value={filters.tiNo}
                onChange={e => setFilters({...filters, tiNo: e.target.value})}
                placeholder="Search TI No..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-gray-500">Item No</Label>
              <Input 
                value={filters.itemNo}
                onChange={e => setFilters({...filters, itemNo: e.target.value})}
                placeholder="Search Item No..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-gray-500">Customer</Label>
              <Input 
                value={filters.customer}
                onChange={e => setFilters({...filters, customer: e.target.value})}
                placeholder="Search Customer..."
              />
            </div>
          </div>

          <div className="border rounded-md bg-white overflow-hidden shadow-sm">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#4a6fa5] text-white">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">TI No</th>
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Item No</th>
                  <th className="px-4 py-2.5 font-semibold">Customer</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.records?.map((record) => (
                  <tr key={record.id} className="hover:bg-blue-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-[#2a4080]">{record.ti_no}</td>
                    <td className="px-4 py-3">{record.ti_date}</td>
                    <td className="px-4 py-3">{record.item_no}</td>
                    <td className="px-4 py-3 text-gray-600 truncate max-w-[200px]">{record.customer_name || "-"}</td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <Button size="sm" variant="outline" className="h-8 border-[#4a6fa5] text-[#4a6fa5] hover:bg-[#4a6fa5] hover:text-white" onClick={() => onSelect(record.ti_no)}>
                        <Eye className="w-4 h-4 mr-1" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
                {(!data?.records || data.records.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">No records found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
