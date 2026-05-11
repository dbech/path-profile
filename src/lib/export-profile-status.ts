export function exportProfileStatus(exported: boolean): string {
  return exported ? "CSV exported" : "Export canceled";
}
