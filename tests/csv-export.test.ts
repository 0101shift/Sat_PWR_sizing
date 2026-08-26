import assert from "node:assert/strict";
import test from "node:test";
import { serializeCsv, UTF8_CSV_BOM } from "../app/lib/csv-export";

test("CSV export uses Excel-compatible line endings and escapes unsafe fields", () => {
  const csv = serializeCsv([
    ["time", "operation", "note"],
    ["01-01-2028 05:30:00 AM", "GSPOINTING, Svalbard", 'payload "locked"'],
  ]);

  assert.equal(
    csv,
    'time,operation,note\r\n01-01-2028 05:30:00 AM,"GSPOINTING, Svalbard","payload ""locked"""',
  );
  assert.equal(UTF8_CSV_BOM.charCodeAt(0), 0xfeff);
});
