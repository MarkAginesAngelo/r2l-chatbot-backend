const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { LANGUAGE_NAMES, CHANNEL_NAMES } = require('./caseReport');

const yesNo = (b) => (b ? 'Yes' : 'No');
const fmt = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 16);

function filterLines(filters) {
  const lines = [];
  lines.push(`Period: ${filters.from ? fmt(filters.from).slice(0, 10) : 'start'} to ${filters.to ? fmt(filters.to).slice(0, 10) : 'now'}`);
  lines.push(`Language: ${filters.language ? LANGUAGE_NAMES[filters.language] : 'All'}`);
  lines.push(`Channel: ${filters.channel ? CHANNEL_NAMES[filters.channel] : 'All'}`);
  lines.push(`Category: ${filters.category || 'All'}`);
  lines.push(`Human agent needed: ${filters.needsHuman ? (filters.needsHuman === 'yes' ? 'Yes' : 'No') : 'All'}`);
  return lines;
}

async function toExcel(report) {
  const { summary, _allRows: rows, filters } = report;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'R2L Chatbot';
  wb.created = new Date();

  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 34 }, { width: 14 }];
  s.addRow(['R2L chatbot — case analytics']).font = { bold: true, size: 14 };
  s.addRow(['Generated', fmt(new Date())]);
  s.addRow([]);
  s.addRow(['Filters']).font = { bold: true };
  filterLines(filters).forEach((l) => s.addRow([l]));
  s.addRow([]);
  s.addRow(['Total cases', summary.total]);
  s.addRow(['Human agent needed', summary.needsHuman]);
  s.addRow(['No human agent needed', summary.noHumanNeeded]);
  for (const [title, list] of [['By language', summary.byLanguage], ['By channel', summary.byChannel], ['By category', summary.byCategory]]) {
    s.addRow([]);
    s.addRow([title]).font = { bold: true };
    list.forEach((x) => s.addRow([x.label, x.count]));
  }
  s.addRow([]);
  s.addRow(['By day']).font = { bold: true };
  summary.byDay.forEach((x) => s.addRow([x.date, x.count]));

  const c = wb.addWorksheet('Cases');
  c.columns = [
    { header: 'Case ID', key: 'id', width: 38 },
    { header: 'Date (UTC)', key: 'date', width: 18 },
    { header: 'Channel', key: 'channel', width: 12 },
    { header: 'Language', key: 'language', width: 10 },
    { header: 'Category', key: 'category', width: 44 },
    { header: 'Scenario', key: 'scenario', width: 52 },
    { header: 'Human agent needed', key: 'needs', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Client', key: 'client', width: 24 },
  ];
  c.getRow(1).font = { bold: true };
  c.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) {
    c.addRow({
      id: r.id,
      date: fmt(r.createdAt),
      channel: CHANNEL_NAMES[r.channel] || r.channel,
      language: LANGUAGE_NAMES[r.language] || r.language,
      category: r.categoryLabel,
      scenario: r.scenarioLabel,
      needs: yesNo(r.needsHuman),
      status: r.status,
      client: r.clientName,
    });
  }
  c.autoFilter = { from: 'A1', to: 'I1' };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toPdf(report) {
  const { summary, _allRows: rows, filters } = report;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('R2L chatbot — case analytics');
    doc.fontSize(9).fillColor('#555').text(`Generated ${fmt(new Date())} UTC`).moveDown(0.5);
    doc.fillColor('#000').fontSize(10);
    filterLines(filters).forEach((l) => doc.text(l));
    doc.moveDown();

    doc.fontSize(12).text(`Total cases: ${summary.total}    Human agent needed: ${summary.needsHuman}    Not needed: ${summary.noHumanNeeded}`);
    doc.moveDown(0.5);
    for (const [title, list] of [['By language', summary.byLanguage], ['By channel', summary.byChannel], ['By category', summary.byCategory]]) {
      doc.fontSize(11).font('Helvetica-Bold').text(title).font('Helvetica').fontSize(10);
      list.forEach((x) => doc.text(`   ${x.label}: ${x.count}`));
      doc.moveDown(0.4);
    }

    doc.addPage().fontSize(12).font('Helvetica-Bold').text('Cases').font('Helvetica').moveDown(0.3);
    const cols = [
      ['Date', 80], ['Channel', 62], ['Lang', 38], ['Category', 150], ['Human?', 44], ['Status', 60],
    ];
    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(8);
      let x = 40;
      const y = doc.y;
      cols.forEach(([h, w]) => { doc.text(h, x, y, { width: w }); x += w; });
      doc.font('Helvetica').moveDown(0.3);
    };
    drawHeader();
    const shortCat = (s) => (s.length > 34 ? `${s.slice(0, 33)}…` : s);
    for (const r of rows.slice(0, 2000)) {
      if (doc.y > 770) { doc.addPage(); drawHeader(); }
      const y = doc.y;
      let x = 40;
      const cells = [fmt(r.createdAt), CHANNEL_NAMES[r.channel] || r.channel, r.language, shortCat(r.categoryLabel), yesNo(r.needsHuman), r.status];
      doc.fontSize(8);
      cells.forEach((t, i) => { doc.text(String(t), x, y, { width: cols[i][1], lineBreak: false }); x += cols[i][1]; });
      doc.y = y + 12;
    }
    if (rows.length > 2000) doc.moveDown().text(`Showing the first 2000 of ${rows.length} cases. Use the Excel export for the full list.`, 40);
    doc.end();
  });
}

module.exports = { toExcel, toPdf };
