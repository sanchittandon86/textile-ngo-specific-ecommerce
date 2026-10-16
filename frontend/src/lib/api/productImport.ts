import { authenticatedFetch } from "@/lib/admin/auth-service";

const API_URL = `${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/admin/products/import`;

export interface ImportRowError {
  row: number;
  field: string;
  message: string;
}

export interface ValidationSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

export interface ImportSummary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  imagesUploaded: number;
}

export interface ImportApiResult {
  success: boolean;
  summary: ValidationSummary | ImportSummary;
  errors: ImportRowError[];
  warnings: string[];
  message?: string;
}

function isImportSummary(summary: ValidationSummary | ImportSummary): summary is ImportSummary {
  return "created" in summary;
}

export { isImportSummary };

async function postFile(path: string, file: File): Promise<ImportApiResult> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await authenticatedFetch(`${API_URL}${path}`, {
    method: "POST",
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));

  // 400s (auth, bad file type/size) only carry { success, message } --
  // normalize to the same shape the UI handles everywhere else.
  if (!("summary" in payload)) {
    return {
      success: false,
      summary: { totalRows: 0, validRows: 0, invalidRows: 0 },
      errors: [{ row: 0, field: "file", message: payload.message || "Something went wrong." }],
      warnings: [],
    };
  }

  return payload as ImportApiResult;
}

export function validateImportFile(file: File): Promise<ImportApiResult> {
  return postFile("/validate", file);
}

export function importFile(file: File): Promise<ImportApiResult> {
  return postFile("", file);
}

// Triggers a browser download of the template -- can't just link to the
// URL directly since the endpoint requires the admin's bearer token.
export async function downloadImportTemplate(): Promise<void> {
  const response = await authenticatedFetch(`${API_URL}/template`);

  if (!response.ok) {
    throw new Error("Unable to download the template.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "product-import-template.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
