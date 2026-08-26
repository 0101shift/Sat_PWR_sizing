export type CsvCell = string | number | boolean | null | undefined;

export const UTF8_CSV_BOM = "\uFEFF";

function escapeCsvCell(value: CsvCell) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function serializeCsv(rows: readonly (readonly CsvCell[])[]) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}
