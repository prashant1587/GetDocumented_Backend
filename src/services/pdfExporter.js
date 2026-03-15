import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ─── pdf-lib coordinate system ───────────────────────────────────────────────
// pdf-lib uses bottom-left origin (0,0).  All Y values here are expressed as
// distances from the BOTTOM of the page so they match pdf-lib exactly.
// A4: 595.28 × 841.89 pts
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 50;

// Header sits at the TOP — convert to bottom-origin
const HEADER_TEXT_Y  = A4_H - 34;   // text baseline from bottom
const HEADER_LINE_Y  = A4_H - 48;   // separator line from bottom
const CONTENT_TOP_Y  = A4_H - 66;   // first content line from bottom

// Footer sits at the BOTTOM
const FOOTER_LINE_Y  = 36;          // separator line from bottom
const FOOTER_TEXT_Y  = 22;          // text baseline from bottom

const FOOTER_MAX_CHARS = 100;

// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BRANDING = {
  companyName: '',
  productName: '',
  primaryColor: '#0f172a',
  secondaryColor: '#334155',
  accentColor: '#2563eb',
  headerLogo: null,
  footerLogo: null,
  headerLogoPosition: 'left',
  headerTitlePlacement: 'center',
  footerText: '',
  footerCompanyInfo: '',
  coverTitle: '',
  coverSubtitle: '',
  watermarkText: '',
  watermarkEnabled: false,
  tableBorderColor: '#cbd5e1',
  introText: '',
  disclaimerText: '',
  summaryText: '',
  fileNameFormat: '{{documentTitle}}-{{date}}',
  locale: 'en-US',
  currencyCode: 'USD',
  language: 'en',
};

const withBranding = (b) => ({ ...DEFAULT_BRANDING, ...(b || {}) });

const truncate = (str, max) => {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max - 1) + '\u2026';
};

// Parse "#rrggbb" → pdf-lib rgb()
const hexToRgb = (hex, fallback = '#000000') => {
  const h = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : fallback;
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// Decode a data-URI base64 image → Uint8Array
const dataUriToBytes = (src) => {
  if (!src || typeof src !== 'string') return null;
  const m = src.match(/^data:.+;base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

// Detect image mime type from data URI
const mimeFromDataUri = (src) => {
  const m = (src || '').match(/^data:([^;]+);/);
  return m ? m[1] : null;
};

// Embed a logo (PNG or JPEG) — returns embedded image or null
const embedLogo = async (pdfDoc, src) => {
  const bytes = dataUriToBytes(src);
  if (!bytes) return null;
  const mime = mimeFromDataUri(src);
  try {
    if (mime === 'image/png')  return await pdfDoc.embedPng(bytes);
    if (mime === 'image/jpeg' || mime === 'image/jpg') return await pdfDoc.embedJpg(bytes);
    // Try PNG first, then JPEG
    try { return await pdfDoc.embedPng(bytes); } catch { return await pdfDoc.embedJpg(bytes); }
  } catch { return null; }
};

// Embed a screenshot (PNG or JPEG bytes Buffer/Uint8Array)
const embedScreenshot = async (pdfDoc, imageData) => {
  if (!imageData) return null;
  const bytes = imageData instanceof Uint8Array ? imageData : new Uint8Array(imageData);
  try { return await pdfDoc.embedPng(bytes); } catch {}
  try { return await pdfDoc.embedJpg(bytes); } catch {}
  return null;
};

// ─── Draw helpers ─────────────────────────────────────────────────────────────

const drawLine = (page, x1, y1, x2, y2, color, thickness = 1) => {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness });
};

// Draw text that never wraps — truncates to fit within maxWidth if needed.
// pdf-lib measures in points, Helvetica ≈ 0.6 × fontSize per char (rough).
const drawSingleLineText = (page, text, x, y, { font, size, color, maxWidth, align = 'left' }) => {
  if (!text) return;
  // Measure and truncate
  let display = text;
  while (display.length > 1 && font.widthOfTextAtSize(display, size) > maxWidth) {
    display = display.slice(0, -2) + '\u2026';
  }
  const textWidth = font.widthOfTextAtSize(display, size);
  let drawX = x;
  if (align === 'center') drawX = x + (maxWidth - textWidth) / 2;
  if (align === 'right')  drawX = x + maxWidth - textWidth;
  page.drawText(display, { x: drawX, y, size, font, color });
};

// Word-wrap text into lines fitting within maxWidth, return array of strings.
const wrapText = (text, font, size, maxWidth) => {
  const words = (text || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
};

// Draw multi-line wrapped text, returns new Y (bottom of last line, bottom-origin).
const drawWrappedText = (page, text, x, startY, { font, size, color, maxWidth, lineHeight }) => {
  const lines = wrapText(text, font, size, maxWidth);
  let y = startY;
  for (const line of lines) {
    if (y < FOOTER_LINE_Y + 20) break; // don't overflow into footer
    page.drawText(line, { x, y, size, font, color });
    y -= lineHeight;
  }
  return y;
};

// ─── Header ───────────────────────────────────────────────────────────────────
const stampHeader = async (page, branding, title, fonts, logoImages) => {
  const { regular } = fonts;
  const primaryColor = hexToRgb(branding.primaryColor, '#0f172a');
  const accentColor  = hexToRgb(branding.accentColor,  '#2563eb');
  const contentW     = A4_W - MARGIN * 2;

  // Logo
  const headerLogo = logoImages.header;
  const logoW = 60, logoH = 24;
  if (headerLogo) {
    const logoX = branding.headerLogoPosition === 'right'
      ? A4_W - MARGIN - logoW
      : MARGIN;
    const scale = Math.min(logoW / headerLogo.width, logoH / headerLogo.height);
    page.drawImage(headerLogo, {
      x: logoX,
      y: HEADER_TEXT_Y - 4,
      width:  headerLogo.width  * scale,
      height: headerLogo.height * scale,
    });
  }

  // Title
  const logoOffset  = headerLogo ? 70 : 0;
  const titleX      = branding.headerTitlePlacement === 'left' ? MARGIN + logoOffset : MARGIN;
  const titleMaxW   = contentW - (branding.headerTitlePlacement === 'left' ? logoOffset : 0);
  drawSingleLineText(page, title, titleX, HEADER_TEXT_Y, {
    font: regular, size: 10, color: primaryColor,
    maxWidth: titleMaxW,
    align: branding.headerTitlePlacement === 'right' ? 'right' : 'center',
  });

  // Separator line
  drawLine(page, MARGIN, HEADER_LINE_Y, A4_W - MARGIN, HEADER_LINE_Y, accentColor, 1.2);
};

// ─── Footer ───────────────────────────────────────────────────────────────────
const stampFooter = (page, branding, pageNum, totalPages, fonts, logoImages) => {
  const { regular } = fonts;
  const secondaryColor = hexToRgb(branding.secondaryColor, '#334155');
  const accentColor    = hexToRgb(branding.accentColor,    '#2563eb');
  const contentW       = A4_W - MARGIN * 2;

  // Separator line
  drawLine(page, MARGIN, FOOTER_LINE_Y, A4_W - MARGIN, FOOTER_LINE_Y, accentColor, 0.8);

  // Footer logo
  const footerLogo = logoImages.footer;
  const LOGO_W = footerLogo ? 54 : 0;
  if (footerLogo) {
    const scale = Math.min(50 / footerLogo.width, 18 / footerLogo.height);
    page.drawImage(footerLogo, {
      x: MARGIN, y: FOOTER_TEXT_Y - 2,
      width:  footerLogo.width  * scale,
      height: footerLogo.height * scale,
    });
  }

  // Column layout
  const PAGE_NUM_W = 90;
  const remaining  = contentW - LOGO_W - PAGE_NUM_W - 8;
  const LEFT_W     = Math.floor(remaining * 0.55);
  const MID_W      = Math.floor(remaining * 0.45);

  if (branding.footerText) {
    drawSingleLineText(page, truncate(branding.footerText, FOOTER_MAX_CHARS),
      MARGIN + LOGO_W, FOOTER_TEXT_Y,
      { font: regular, size: 9, color: secondaryColor, maxWidth: LEFT_W, align: 'left' });
  }

  if (branding.footerCompanyInfo) {
    drawSingleLineText(page, truncate(branding.footerCompanyInfo, FOOTER_MAX_CHARS),
      MARGIN + LOGO_W + LEFT_W + 4, FOOTER_TEXT_Y,
      { font: regular, size: 9, color: secondaryColor, maxWidth: MID_W, align: 'center' });
  }

  // Page number
  drawSingleLineText(page, 'Page ' + pageNum + ' of ' + totalPages,
    A4_W - MARGIN - PAGE_NUM_W, FOOTER_TEXT_Y,
    { font: regular, size: 9, color: secondaryColor, maxWidth: PAGE_NUM_W, align: 'right' });
};

// ─── Watermark ────────────────────────────────────────────────────────────────
const stampWatermark = (page, branding, fonts) => {
  if (!branding.watermarkEnabled || !branding.watermarkText) return;
  const color = hexToRgb(branding.secondaryColor, '#334155');
  page.drawText(branding.watermarkText, {
    x: 80, y: 300,
    size: 48,
    font: fonts.regular,
    color: rgb(color.red, color.green, color.blue),
    opacity: 0.08,
    rotate: { type: 'degrees', angle: 35 },
  });
};

// ─── Page factory ─────────────────────────────────────────────────────────────
const addPage = (pdfDoc, branding, fonts) => {
  const page = pdfDoc.addPage([A4_W, A4_H]);
  stampWatermark(page, branding, fonts);
  return page;
};

// ─── Text section page ────────────────────────────────────────────────────────
const addTextPage = (pdfDoc, branding, fonts, heading, body) => {
  if (!body || !body.trim()) return null;
  const page    = addPage(pdfDoc, branding, fonts);
  const primary = hexToRgb(branding.primaryColor, '#0f172a');
  const contentW = A4_W - MARGIN * 2;

  page.drawText(heading, { x: MARGIN, y: CONTENT_TOP_Y, size: 22, font: fonts.bold, color: primary });

  drawWrappedText(page, body, MARGIN, CONTENT_TOP_Y - 32, {
    font: fonts.regular, size: 12, color: rgb(0, 0, 0),
    maxWidth: contentW, lineHeight: 18,
  });

  return page;
};

// ─── Public helpers ───────────────────────────────────────────────────────────
export const buildExportFileName = ({ title, documentId, branding: brandingInput }) => {
  const branding = withBranding(brandingInput);
  const date = new Intl.DateTimeFormat(branding.locale || 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replace(/[^\d]+/g, '-');

  const raw = (branding.fileNameFormat || DEFAULT_BRANDING.fileNameFormat)
    .replaceAll('{{documentTitle}}', title || 'document-' + documentId)
    .replaceAll('{{companyName}}',   branding.companyName || '')
    .replaceAll('{{productName}}',   branding.productName || '')
    .replaceAll('{{date}}',          date);

  const safe = raw.toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  return (safe || 'document-' + documentId) + '.pdf';
};

// ─── Main export ──────────────────────────────────────────────────────────────
export const buildWalkthroughPdf = async ({ title, subtitle, steps, branding: brandingInput }) => {
  const branding = withBranding(brandingInput);
  const pdfDoc   = await PDFDocument.create();

  // Embed fonts — pdf-lib uses standard built-in fonts (no file needed)
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular: regularFont, bold: boldFont };

  // Embed logos once
  const logoImages = {
    header: await embedLogo(pdfDoc, branding.headerLogo),
    footer: await embedLogo(pdfDoc, branding.footerLogo),
  };

  const primary   = hexToRgb(branding.primaryColor,   '#0f172a');
  const secondary = hexToRgb(branding.secondaryColor, '#334155');
  const border    = hexToRgb(branding.tableBorderColor, '#cbd5e1');
  const contentW  = A4_W - MARGIN * 2;
  const PAGE_BOTTOM_Y = FOOTER_LINE_Y + 20; // lowest Y content can reach

  // ── Cover page ─────────────────────────────────────────────────────────────
  if (branding.coverTitle || branding.coverSubtitle) {
    const page = addPage(pdfDoc, branding, fonts);
    if (logoImages.header || logoImages.footer) {
      const logo = logoImages.header || logoImages.footer;
      const scale = Math.min(150 / logo.width, 80 / logo.height);
      page.drawImage(logo, { x: MARGIN, y: A4_H - 70 - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
    }
    page.drawText(branding.coverTitle || title || 'Walkthrough Export', {
      x: MARGIN, y: A4_H - 200, size: 28, font: boldFont, color: primary,
      maxWidth: 500,
    });
    if (branding.coverSubtitle) {
      page.drawText(branding.coverSubtitle, {
        x: MARGIN, y: A4_H - 240, size: 15, font: regularFont, color: secondary, maxWidth: 500,
      });
    }
  }

  // ── Optional intro / disclaimer ────────────────────────────────────────────
  addTextPage(pdfDoc, branding, fonts, 'Introduction', branding.introText);
  addTextPage(pdfDoc, branding, fonts, 'Disclaimer',   branding.disclaimerText);

  // ── No steps fallback ──────────────────────────────────────────────────────
  if (!steps || !steps.length) {
    const page = addPage(pdfDoc, branding, fonts);
    page.drawText(title || 'Walkthrough Export', { x: MARGIN, y: CONTENT_TOP_Y, size: 18, font: boldFont, color: primary });
    page.drawText(subtitle || 'No steps found.', { x: MARGIN, y: CONTENT_TOP_Y - 28, size: 12, font: regularFont, color: rgb(0,0,0) });
    addTextPage(pdfDoc, branding, fonts, 'Summary', branding.summaryText);
    return await finalise(pdfDoc, branding, title, fonts, logoImages);
  }

  // ── Step pages ─────────────────────────────────────────────────────────────
  const MAX_IMG_H = 320;

  // Helper: measure how tall a step will be (in pts)
  const measureStep = async (step, index) => {
    const titleLines = wrapText(String(index + 1) + '. ' + step.title, boldFont, 20, contentW);
    const descLines  = wrapText(step.description || 'No description provided.', regularFont, 12, contentW);
    const titleH = titleLines.length * 26;
    const descH  = descLines.length  * 18;
    let imgH = 0;
    if (step.imageData) {
      try {
        const img = await embedScreenshot(pdfDoc, step.imageData);
        if (img) {
          const scale = Math.min(contentW / img.width, MAX_IMG_H / img.height, 1);
          imgH = img.height * scale + 20; // 20 = border padding + gap
        }
      } catch { /* no image */ }
    }
    return { titleH, descH, imgH, total: titleH + 8 + descH + 16 + imgH };
  };

  // Open first page
  let page    = addPage(pdfDoc, branding, fonts);
  let currentY = CONTENT_TOP_Y;

  for (let index = 0; index < steps.length; index++) {
    const step   = steps[index];
    const gap    = currentY < CONTENT_TOP_Y ? 18 : 0;
    const layout = await measureStep(step, index);

    // Need a new page? (never for index 0 — we just opened one)
    if (index > 0 && currentY - gap - layout.total < PAGE_BOTTOM_Y) {
      page     = addPage(pdfDoc, branding, fonts);
      currentY = CONTENT_TOP_Y;
    } else {
      currentY -= gap;
    }

    // Step title
    const titleLines = wrapText(String(index + 1) + '. ' + step.title, boldFont, 20, contentW);
    for (const line of titleLines) {
      page.drawText(line, { x: MARGIN, y: currentY, size: 20, font: boldFont, color: primary });
      currentY -= 26;
    }
    currentY -= 8;

    // Description
    const descLines = wrapText(step.description || 'No description provided.', regularFont, 12, contentW);
    for (const line of descLines) {
      page.drawText(line, { x: MARGIN, y: currentY, size: 12, font: regularFont, color: rgb(0, 0, 0) });
      currentY -= 18;
    }
    currentY -= 16;

    // Screenshot
    if (step.imageData) {
      try {
        const img = await embedScreenshot(pdfDoc, step.imageData);
        if (img) {
          const scale  = Math.min(contentW / img.width, MAX_IMG_H / img.height, 1);
          const imgW   = img.width  * scale;
          const imgH   = img.height * scale;
          const imgX   = MARGIN + (contentW - imgW) / 2;
          const boxH   = imgH + 12;
          const boxY   = currentY - boxH;

          // Border rect (pdf-lib Y = bottom-left of rect)
          page.drawRectangle({
            x: MARGIN, y: boxY, width: contentW, height: boxH,
            borderColor: border, borderWidth: 1, color: rgb(1, 1, 1),
          });
          page.drawImage(img, { x: imgX, y: boxY + 6, width: imgW, height: imgH });
          currentY = boxY - 8;
        }
      } catch {
        page.drawText('Could not render screenshot.', { x: MARGIN, y: currentY, size: 12, font: regularFont, color: rgb(0.8, 0, 0) });
        currentY -= 20;
      }
    }
  }

  addTextPage(pdfDoc, branding, fonts, 'Summary', branding.summaryText);

  return await finalise(pdfDoc, branding, title, fonts, logoImages);
};

// ─── Finalise: stamp header + footer on every page ────────────────────────────
// pdf-lib pages are stored in a plain array — pdfDoc.getPages() always returns
// exactly the pages we added, in order, indexed from 0.  No buffer offset quirks.
const finalise = async (pdfDoc, branding, title, fonts, logoImages) => {
  const pages = pdfDoc.getPages(); // simple array, always correct
  const total = pages.length;

  for (let i = 0; i < total; i++) {
    await stampHeader(pages[i], branding, title || 'Walkthrough Export', fonts, logoImages);
    stampFooter(pages[i], branding, i + 1, total, fonts, logoImages);
  }

  return await pdfDoc.save(); // returns Uint8Array
};

// ─── Screenshots convenience export ──────────────────────────────────────────
export const buildScreenshotsPdf = (screenshots) =>
  buildWalkthroughPdf({
    title:    'Screenshots Export',
    subtitle: 'No screenshots found.',
    steps:    screenshots.map((s) => ({
      title:       s.title,
      description: s.description,
      imageData:   s.imageData,
    })),
  });