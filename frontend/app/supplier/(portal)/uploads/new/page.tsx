"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supplierApiFetch } from "@/lib/supplier-api";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea, Badge } from "@/components/ui";

interface UploadResult {
  id: string;
  originalName: string;
  rowCount: number;
  status: string;
  issues: Array<{ row: number; field: string; message: string }>;
  items: Array<{ sku: string; poNumber: string; itemDescription: string }>;
}

export default function SupplierUploadNewPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") setContent(text);
    };
    reader.readAsText(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      setError("Please select a CSV file first");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await supplierApiFetch<UploadResult>("/supplier-portal/uploads", {
        method: "POST",
        body: { fileName, content },
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className="space-y-7">
        <header>
          <Badge color="green" className="mb-3">Sent for review</Badge>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] text-zinc-950">{result.originalName}</h1>
          <p className="mt-2 text-sm text-zinc-500">
            {result.rowCount} row{result.rowCount !== 1 && "s"} parsed and sent to the vendor for review.
            You&apos;ll be notified when the vendor responds.
          </p>
        </header>

        {result.issues.length > 0 ? (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-amber-800">Data quality flags</CardTitle>
              <p className="text-xs text-amber-700">The vendor may flag these as reasons for rejection.</p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm text-amber-700">
                {result.issues.map((issue, i) => (
                  <li key={i}>Row {issue.row}: <span className="font-semibold">{issue.field}</span> — {issue.message}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex gap-2">
          <Button onClick={() => router.push(`/supplier/uploads/${result.id}`)}>
            View upload
          </Button>
          <Button variant="outline" onClick={() => router.push("/supplier/uploads")}>Go to uploads</Button>
          <Button variant="outline" onClick={() => { setResult(null); setContent(""); setFileName(""); fileRef.current?.click(); }}>
            Upload another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-7">
      <header>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-700">New submission</p>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] text-zinc-950">Upload product file</h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-500">
          Upload a CSV file with your product shipments. Required columns: <span className="font-mono text-xs">po_number, sku, item_description, order_qty, unit_price_bdt, total_amount_bdt</span>.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-5">
            <label className="grid gap-2 text-sm font-semibold text-zinc-700">
              Select CSV file
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-700 hover:file:bg-zinc-200"
                required
              />
            </label>

            {fileName && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-zinc-700">{fileName}</span>
                  <Badge color="indigo">{content.split("\n").filter((l) => l.trim()).length - 1} rows</Badge>
                </div>
              </div>
            )}

            {content && (
              <label className="grid gap-2 text-sm font-semibold text-zinc-700">
                Preview and edit content
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={14}
                  className="font-mono text-xs"
                />
              </label>
            )}

            {error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
            ) : null}

            <Button type="submit" disabled={loading || !content.trim()} className="w-full">
              {loading ? "Uploading..." : "Upload and send for review"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}