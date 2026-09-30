"use client";

import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { useState } from "react";
import { toUserMessage } from "@/lib/convex-error";
import { todayInJst } from "@/lib/date";
import { inputClass, secondaryButtonClass } from "@/lib/ui";

type ExportKind = "expenses" | "settlements";

export default function CsvExport() {
  const exportCsv = useAction(api.export.csv);
  const [today] = useState(todayInJst);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(kind: ExportKind) {
    setError(null);
    setExporting(kind);
    try {
      const result = await exportCsv({ kind, from, to });
      const blob = new Blob([result.csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) {
      setError(toUserMessage(caught));
    } finally {
      setExporting(null);
    }
  }

  const disabled = exporting !== null || from.length === 0 || to.length === 0;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted">データ</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted">開始日</span>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            disabled={exporting !== null}
            required
            className={`${inputClass} disabled:opacity-50`}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">終了日</span>
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            disabled={exporting !== null}
            required
            className={`${inputClass} disabled:opacity-50`}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleExport("expenses")}
          disabled={disabled}
          className={secondaryButtonClass}
        >
          {exporting === "expenses" ? "保存中…" : "支出をCSVで保存"}
        </button>
        <button
          type="button"
          onClick={() => void handleExport("settlements")}
          disabled={disabled}
          className={secondaryButtonClass}
        >
          {exporting === "settlements" ? "保存中…" : "精算をCSVで保存"}
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
