export type SchedulePdfRow = {
  date: string;
  time: string;
  round: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  status: string;
};

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const SCALE = 300 / 72;
const MARGIN = 24;
const FONT_SIZE = 8.25;
const LINE_HEIGHT = 10.5;
const PADDING = 4;
const HEADER_HEIGHT = 23;
const FONT_FAMILY = '"Segoe UI", Arial, sans-serif';
const TITLES = ["Ngày", "Giờ", "Vòng", "Mã trận", "Đội nhà", "Đội khách", "Sân", "Trạng thái"];
const TEAM_WIDTH = (PAGE_WIDTH - MARGIN * 2 - 462) / 2;
const WIDTHS = [54, 68, 74, 126, TEAM_WIDTH, TEAM_WIDTH, 72, 68];

type WrappedRow = { cells: string[][]; height: number; fixtureId: string };
type PageImage = { bytes: Uint8Array; width: number; height: number };

function wrapText(context: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.normalize("NFC").split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      // Identifiers and long names must wrap without dropping characters.
      for (const character of Array.from(word)) {
        if (line && context.measureText(line + character).width > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

function utf16Hex(value: string): string {
  let result = "FEFF";
  for (let index = 0; index < value.length; index += 1) result += value.charCodeAt(index).toString(16).padStart(4, "0");
  return result;
}

function encodePdf(images: PageImage[], title: string): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const append = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
    parts.push(bytes);
    length += bytes.byteLength;
  };
  const beginObject = (id: number) => {
    offsets[id] = length;
    append(`${id} 0 obj\n`);
  };
  append("%PDF-1.4\n");
  append(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  beginObject(1);
  append("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  beginObject(2);
  append(`<< /Type /Pages /Kids [${images.map((_, index) => `${3 + index * 3} 0 R`).join(" ")}] /Count ${images.length} >>\nendobj\n`);
  images.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    beginObject(pageId);
    append(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);
    beginObject(imageId);
    append(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.byteLength} >>\nstream\n`);
    append(image.bytes);
    append("\nendstream\nendobj\n");
    beginObject(contentId);
    const content = `q\n${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm\n/Im1 Do\nQ\n`;
    append(`<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}endstream\nendobj\n`);
  });
  const infoId = 3 + images.length * 3;
  beginObject(infoId);
  append(`<< /Title <${utf16Hex(title)}> /Producer (San Co Schedule PDF) >>\nendobj\n`);
  const xrefOffset = length;
  append(`xref\n0 ${infoId + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= infoId; id += 1) append(`${offsets[id].toString().padStart(10, "0")} 00000 n \n`);
  append(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

/** Printable image PDF: native fonts preserve Vietnamese without redistributing font files. */
export async function createSchedulePdf(tournamentName: string, rows: readonly SchedulePdfRow[]): Promise<Blob> {
  if (!rows.length) throw new Error("Chưa có trận nào có lịch để xuất PDF.");
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(PAGE_WIDTH * SCALE);
  canvas.height = Math.ceil(PAGE_HEIGHT * SCALE);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Trình duyệt không hỗ trợ tạo bản PDF. Vui lòng thử lại bằng trình duyệt khác.");
  context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  context.font = `bold 14px ${FONT_FAMILY}`;
  const titleLines = wrapText(context, tournamentName, PAGE_WIDTH - MARGIN * 2);
  const tableTop = MARGIN + titleLines.length * 18 + 26;
  const tableBottom = PAGE_HEIGHT - MARGIN - 20;
  const availableHeight = tableBottom - tableTop - HEADER_HEIGHT;
  if (availableHeight < 50) throw new Error("Tên giải quá dài để tạo bản in PDF.");
  context.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  const wrappedRows: WrappedRow[] = rows.map((row) => {
    const values = [row.date, row.time, row.round, row.fixtureId, row.homeTeam, row.awayTeam, row.venue, row.status];
    const cells = values.map((value, index) => wrapText(context, value, WIDTHS[index] - PADDING * 2));
    return { cells, height: Math.max(...cells.map((cell) => cell.length)) * LINE_HEIGHT + PADDING * 2, fixtureId: row.fixtureId };
  });
  const pages: WrappedRow[][] = [];
  let pageRows: WrappedRow[] = [];
  let usedHeight = 0;
  for (const row of wrappedRows) {
    if (row.height > availableHeight) throw new Error(`Thông tin trận ${row.fixtureId} quá dài để hiển thị đầy đủ trên một trang PDF.`);
    if (usedHeight + row.height > availableHeight) {
      pages.push(pageRows);
      pageRows = [];
      usedHeight = 0;
    }
    pageRows.push(row);
    usedHeight += row.height;
  }
  if (pageRows.length) pages.push(pageRows);
  const images: PageImage[] = [];
  try {
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      context.textBaseline = "top";
      context.fillStyle = "#18392c";
      context.font = `bold 14px ${FONT_FAMILY}`;
      titleLines.forEach((line, index) => context.fillText(line, MARGIN, MARGIN + index * 18));
      context.fillStyle = "#354c41";
      context.font = `bold 10px ${FONT_FAMILY}`;
      context.fillText(`LỊCH THI ĐẤU - ${rows.length} trận`, MARGIN, MARGIN + titleLines.length * 18 + 4);
      let x = MARGIN;
      context.fillStyle = "#e8f0eb";
      context.fillRect(MARGIN, tableTop, PAGE_WIDTH - MARGIN * 2, HEADER_HEIGHT);
      context.strokeStyle = "#c5d3ca";
      context.lineWidth = 0.5;
      context.font = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
      TITLES.forEach((title, index) => {
        context.fillStyle = "#18392c";
        context.fillText(title, x + PADDING, tableTop + 7);
        context.strokeRect(x, tableTop, WIDTHS[index], HEADER_HEIGHT);
        x += WIDTHS[index];
      });
      let y = tableTop + HEADER_HEIGHT;
      context.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
      pages[pageIndex].forEach((row, rowIndex) => {
        if (rowIndex % 2 === 1) {
          context.fillStyle = "#f7f9f7";
          context.fillRect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, row.height);
        }
        x = MARGIN;
        row.cells.forEach((lines, columnIndex) => {
          context.strokeStyle = "#d3dcd6";
          context.strokeRect(x, y, WIDTHS[columnIndex], row.height);
          context.fillStyle = "#17251d";
          lines.forEach((line, lineIndex) => context.fillText(line, x + PADDING, y + PADDING + lineIndex * LINE_HEIGHT));
          x += WIDTHS[columnIndex];
        });
        y += row.height;
      });
      context.fillStyle = "#53665b";
      context.font = `8px ${FONT_FAMILY}`;
      context.fillText(`Trang ${pageIndex + 1} / ${pages.length}`, MARGIN, PAGE_HEIGHT - MARGIN);
      const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Trình duyệt không tạo được trang PDF. Vui lòng thử lại."));
      }, "image/jpeg", 0.94));
      images.push({ bytes: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    return encodePdf(images, `Lịch thi đấu - ${tournamentName}`);
  } finally {
    // Release the single reusable 300-DPI page canvas, including on failures.
    canvas.width = 0;
    canvas.height = 0;
  }
}
