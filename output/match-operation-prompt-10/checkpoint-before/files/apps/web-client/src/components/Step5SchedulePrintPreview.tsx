import { useState } from "react";
import type { DemoFixture, DemoScheduleEntry } from "../utils/drawTestStorage";
import { createSchedulePdf } from "../utils/schedulePdf";

type Props = {
  tournamentName: string;
  fixtures: DemoFixture[];
  entries: Record<string, DemoScheduleEntry>;
  teamNames: Map<string, string>;
  venueName: (fixtureId: string, entry: DemoScheduleEntry) => string;
  durationMinutes: (fixture: DemoFixture, entry: DemoScheduleEntry) => number;
  simulatedFixtureIds?: ReadonlySet<string>;
  compact?: boolean;
};

function participantName(teamId: string | null, source?: string, teamNames?: Map<string, string>): string {
  if (teamId) return teamNames?.get(teamId) ?? teamId;
  return source ?? "Chờ xác định";
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function localDate(value: string): string {
  return new Date(value).toLocaleDateString("vi-VN");
}

function localTime(value: string): string {
  return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export function Step5SchedulePrintPreview({ tournamentName, fixtures, entries, teamNames, venueName, durationMinutes, simulatedFixtureIds = new Set<string>(), compact = false }: Props) {
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const rows = fixtures.flatMap((fixture) => {
    const entry = entries[fixture.id];
    if (!entry?.scheduledAt || !entry.venue) return [];
    const endAt = new Date(new Date(entry.scheduledAt).getTime() + durationMinutes(fixture, entry) * 60_000).toISOString();
    return [{ fixture, entry, endAt, isProposed: simulatedFixtureIds.has(fixture.id) }];
  }).sort((left, right) => left.entry.scheduledAt.localeCompare(right.entry.scheduledAt));

  function exportCsv() {
    const header = ["Ngày", "Giờ bắt đầu", "Giờ kết thúc", "Giai đoạn", "Vòng", "Mã trận", "Đội nhà", "Đội khách", "Sân", "Trạng thái"];
    const data = rows.map(({ fixture, entry, endAt, isProposed }) => [
      localDate(entry.scheduledAt), localTime(entry.scheduledAt), localTime(endAt), fixture.stage === "GROUP" ? "Vòng bảng" : "Loại trực tiếp",
      fixture.round, fixture.id, participantName(fixture.homeTeamId, fixture.homeSource, teamNames), participantName(fixture.awayTeamId, fixture.awaySource, teamNames),
      venueName(fixture.id, entry), isProposed ? "Phương án chưa lưu" : entry.officialStatus === "PUBLISHED" ? "Đã công bố" : entry.locked ? "Đã khóa" : "Bản nháp",
    ]);
    const csv = `\uFEFF${[header, ...data].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    const safeName = tournamentName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "giai-dau";
    link.href = blobUrl;
    link.download = `lich-thi-dau-${safeName}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
  }

  async function exportPdf() {
    if (exportingPdf) return;
    setExportingPdf(true);
    setPdfError("");
    try {
      const pdf = await createSchedulePdf(tournamentName, rows.map(({ fixture, entry, endAt, isProposed }) => ({
        date: localDate(entry.scheduledAt),
        time: `${localTime(entry.scheduledAt)}-${localTime(endAt)}`,
        round: fixture.round,
        fixtureId: fixture.id,
        homeTeam: participantName(fixture.homeTeamId, fixture.homeSource, teamNames),
        awayTeam: participantName(fixture.awayTeamId, fixture.awaySource, teamNames),
        venue: venueName(fixture.id, entry),
        status: isProposed ? "Phương án chưa lưu" : entry.officialStatus === "PUBLISHED" ? "Đã công bố" : entry.locked ? "Đã khóa" : "Bản nháp",
      })));
      const blobUrl = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      const safeName = tournamentName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "giai-dau";
      link.href = blobUrl;
      link.download = `lich-thi-dau-${safeName}.pdf`;
      document.body.append(link);
      try { link.click(); } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
      }
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "Không thể xuất PDF. Vui lòng thử lại.");
    } finally {
      setExportingPdf(false);
    }
  }

  const printActions = <div className="step5-print-actions">
    <button type="button" className="button button-secondary" disabled={!rows.length} onClick={() => window.print()}>In lịch</button>
    <button type="button" className="button button-secondary" disabled={!rows.length || exportingPdf} onClick={() => { void exportPdf(); }} title="Tải PDF bản in dạng ảnh, giữ đầy đủ tiếng Việt">{exportingPdf ? "Đang xuất PDF…" : "Xuất PDF"}</button>
    <button type="button" className="button button-secondary" disabled={!rows.length} onClick={exportCsv} title="Tải tệp CSV UTF-8">Xuất CSV</button>
  </div>;
  const exportError = pdfError ? <p className="form-error" role="alert">{pdfError}</p> : null;
  const printOutput = <div className="step5-print-output">
      <div className="step5-print-title"><strong>{tournamentName}</strong><span>LỊCH THI ĐẤU</span></div>
      {rows.length ? <div className="step5-print-table-wrap"><table>
        <thead><tr><th>Ngày</th><th>Giờ</th><th>Vòng</th><th>Mã trận</th><th>Đội nhà</th><th>Đội khách</th><th>Sân</th><th>Trạng thái</th></tr></thead>
        <tbody>{rows.map(({ fixture, entry, endAt, isProposed }) => <tr key={fixture.id}>
          <td>{localDate(entry.scheduledAt)}</td><td>{localTime(entry.scheduledAt)}–{localTime(endAt)}</td>
          <td>{fixture.round}</td><td>{fixture.id}</td>
          <td>{participantName(fixture.homeTeamId, fixture.homeSource, teamNames)}</td>
          <td>{participantName(fixture.awayTeamId, fixture.awaySource, teamNames)}</td>
          <td>{venueName(fixture.id, entry)}</td><td>{isProposed ? "Phương án chưa lưu" : entry.officialStatus === "PUBLISHED" ? "Đã công bố" : entry.locked ? "Đã khóa" : "Bản nháp"}</td>
        </tr>)}</tbody>
      </table></div> : <p className="step5-print-empty">Chưa có trận nào được xếp lịch để xem trước.</p>}
    </div>;
  return <section className={`step5-print-panel ${compact ? "is-compact" : ""}`} aria-label="Xem trước và in lịch">
    {compact ? <details className="step5-print-utility"><summary>In / PDF · CSV</summary><div className="step5-print-utility-popover"><p>{rows.length} trận trong danh sách đã lọc.</p>{printActions}{exportError}{printOutput}</div></details> : <><header className="step5-print-panel-heading">
      <div><span className="eyebrow">BẢN IN</span><h3>Xem trước lịch thi đấu</h3><p>{rows.length} trận có ngày, giờ và sân · bảng tính tải về ở định dạng CSV mở được bằng Excel.</p></div>
      {printActions}
    </header>{exportError}{printOutput}</>}
  </section>;
}
