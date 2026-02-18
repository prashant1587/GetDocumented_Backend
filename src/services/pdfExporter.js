import PDFDocument from 'pdfkit';

export const buildScreenshotsPdf = (screenshots) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 50 });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    screenshots.forEach((screenshot, index) => {
      doc.addPage();
      doc.fontSize(18).text(`${index + 1}. ${screenshot.title}`, { underline: true });
      doc.moveDown(0.75);
      doc.fontSize(12).text(screenshot.description || 'No description provided.');
      doc.moveDown(1);

      const imageBoxWidth = 500;
      const imageBoxHeight = 620;
      const yStart = doc.y;

      try {
        doc.image(Buffer.from(screenshot.imageData), doc.page.margins.left, yStart, {
          fit: [imageBoxWidth, imageBoxHeight],
          align: 'center',
          valign: 'top'
        });
      } catch {
        doc.fontSize(12).fillColor('red').text('Could not render screenshot image in PDF.');
        doc.fillColor('black');
      }
    });

    if (screenshots.length === 0) {
      doc.addPage();
      doc.fontSize(18).text('Screenshots Export');
      doc.moveDown();
      doc.fontSize(12).text('No screenshots found.');
    }

    doc.end();
  });
};
