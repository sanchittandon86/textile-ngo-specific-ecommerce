"use client";

import { useState } from "react";
import Link from "next/link";
import {
  downloadImportTemplate,
  validateImportFile,
  importFile,
  isImportSummary,
  type ImportApiResult,
} from "@/lib/api/productImport";

type Stage = "idle" | "validating" | "validated" | "importing" | "imported";

export default function BulkImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<ImportApiResult | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setStage("idle");
    setResult(null);
  }

  async function handleDownloadTemplate() {
    setDownloadError(null);
    try {
      await downloadImportTemplate();
    } catch {
      setDownloadError("Unable to download the template. Please try again.");
    }
  }

  async function handleValidate() {
    if (!file) return;
    setStage("validating");
    setResult(null);

    try {
      const response = await validateImportFile(file);
      setResult(response);
      setStage("validated");
    } catch {
      setResult({
        success: false,
        summary: { totalRows: 0, validRows: 0, invalidRows: 0 },
        errors: [{ row: 0, field: "file", message: "Unable to validate this file. Please try again." }],
        warnings: [],
      });
      setStage("validated");
    }
  }

  async function handleImport() {
    if (!file) return;
    setStage("importing");

    try {
      const response = await importFile(file);
      setResult(response);
      setStage("imported");
    } catch {
      setResult({
        success: false,
        summary: { totalRows: 0, validRows: 0, invalidRows: 0 },
        errors: [{ row: 0, field: "file", message: "Import failed unexpectedly. Please try again." }],
        warnings: [],
      });
      setStage("imported");
    }
  }

  function handleReset() {
    setFile(null);
    setStage("idle");
    setResult(null);
  }

  const canValidate = Boolean(file) && stage !== "validating" && stage !== "importing";
  const validationPassed = result?.success === true;
  const showImportStep = (stage === "validated" || stage === "importing") && validationPassed;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">Bulk Product Import</h1>
        <Link href="/admin/products" className="text-xs tracking-wide text-ink-muted uppercase hover:text-olive-700">
          ← Back to Products
        </Link>
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        Products are managed only through this Excel import -- there is no individual
        product form. Download the template, fill it in, validate it, then import.
      </p>

      {/* Step 1 */}
      <section className="mt-8 border border-beige p-5">
        <h2 className="text-sm font-medium tracking-wide text-ink-muted uppercase">Step 1</h2>
        <div className="mt-3 flex items-center gap-4">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="border border-olive-700 px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-olive-800 uppercase transition-colors hover:bg-olive-700 hover:text-ivory"
          >
            Download Excel Template
          </button>
          {downloadError && <p className="text-xs text-terracotta-600">{downloadError}</p>}
        </div>
      </section>

      {/* Step 2 */}
      <section className="mt-6 border border-beige p-5">
        <h2 className="text-sm font-medium tracking-wide text-ink-muted uppercase">Step 2</h2>
        <p className="mt-1 text-sm text-ink-muted">Upload your completed Excel file.</p>
        <div className="mt-3 flex items-center gap-4">
          <label className="cursor-pointer border border-beige-dark px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-ink uppercase transition-colors hover:border-olive-600">
            Choose File
            <input type="file" accept=".xlsx" onChange={handleFileSelect} className="hidden" />
          </label>
          {file && (
            <p className="text-sm text-ink">
              {file.name}{" "}
              <span className="text-ink-muted">({(file.size / 1024).toFixed(0)} KB)</span>
            </p>
          )}
        </div>
      </section>

      {/* Step 3 */}
      <section className="mt-6 border border-beige p-5">
        <h2 className="text-sm font-medium tracking-wide text-ink-muted uppercase">Step 3</h2>
        <div className="mt-3">
          <button
            type="button"
            onClick={handleValidate}
            disabled={!canValidate}
            className="bg-olive-700 px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-ivory uppercase transition-colors hover:bg-olive-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {stage === "validating" ? "Validating..." : "Validate File"}
          </button>
        </div>

        {result && stage !== "imported" && (
          <div className="mt-5">
            {result.success ? (
              <p className="text-sm font-medium text-olive-700">
                ✓ {result.summary.totalRows} row{result.summary.totalRows === 1 ? "" : "s"} ready to import
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-terracotta-600">
                  {"validRows" in result.summary && (
                    <>
                      ✓ {result.summary.validRows} valid row{result.summary.validRows === 1 ? "" : "s"} &nbsp;•&nbsp; ✕{" "}
                      {result.summary.invalidRows} invalid row{result.summary.invalidRows === 1 ? "" : "s"}
                    </>
                  )}
                </p>
                <ul className="mt-3 flex flex-col gap-1.5 border border-terracotta-500 bg-terracotta-400/5 p-4 text-sm text-ink">
                  {result.errors.map((error, index) => (
                    <li key={index}>
                      {error.row > 0 ? (
                        <>
                          <span className="font-medium">Row {error.row}</span> — {error.message}
                        </>
                      ) : (
                        error.message
                      )}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={handleReset}
                  className="mt-4 text-xs tracking-wide text-ink-muted uppercase hover:text-olive-700"
                >
                  Fix Excel &amp; Upload Again
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {/* Step 4 */}
      {showImportStep && (
        <section className="mt-6 border border-olive-700 bg-sage-100/40 p-5">
          <h2 className="text-sm font-medium tracking-wide text-ink-muted uppercase">Step 4</h2>
          <p className="mt-1 text-sm text-ink">File is validated and ready.</p>
          <button
            type="button"
            onClick={handleImport}
            disabled={stage === "importing"}
            className="mt-3 bg-olive-700 px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-ivory uppercase transition-colors hover:bg-olive-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stage === "importing" ? "Importing..." : "Import Products"}
          </button>
        </section>
      )}

      {/* Final result */}
      {stage === "imported" && result && (
        <section className="mt-6 border border-beige p-5">
          {result.success && isImportSummary(result.summary) ? (
            <>
              <h2 className="font-serif text-lg text-ink">Import completed</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-xs tracking-wide text-ink-muted uppercase">Created</dt>
                  <dd className="mt-1 font-serif text-xl text-ink">{result.summary.created}</dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wide text-ink-muted uppercase">Updated</dt>
                  <dd className="mt-1 font-serif text-xl text-ink">{result.summary.updated}</dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wide text-ink-muted uppercase">Skipped</dt>
                  <dd className="mt-1 font-serif text-xl text-ink">{result.summary.skipped}</dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wide text-ink-muted uppercase">Images Uploaded</dt>
                  <dd className="mt-1 font-serif text-xl text-ink">{result.summary.imagesUploaded}</dd>
                </div>
              </dl>
              <div className="mt-5 flex gap-4">
                <Link
                  href="/admin/products"
                  className="bg-olive-700 px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-ivory uppercase transition-colors hover:bg-olive-800"
                >
                  View Products
                </Link>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs tracking-wide text-ink-muted uppercase hover:text-olive-700"
                >
                  Import Another File
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="font-serif text-lg text-terracotta-600">Import failed</h2>
              <p className="mt-2 text-sm text-ink-muted">No changes were made to the catalog.</p>
              <ul className="mt-3 flex flex-col gap-1.5 border border-terracotta-500 bg-terracotta-400/5 p-4 text-sm text-ink">
                {result.errors.map((error, index) => (
                  <li key={index}>{error.message}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={handleReset}
                className="mt-4 text-xs tracking-wide text-ink-muted uppercase hover:text-olive-700"
              >
                Try Again
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
