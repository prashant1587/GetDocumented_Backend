import PDFDocument from 'pdfkit';

export const buildWalkthroughPdf = ({ title, subtitle, steps }) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 50 });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    if (!steps.length) {
      doc.addPage();
      doc.fontSize(18).text(title || 'Walkthrough Export');
      doc.moveDown();
      doc.fontSize(12).text(subtitle || 'No steps found.');
      doc.end();
      return;
    }

    steps.forEach((step, index) => {
      doc.addPage();
      doc.fontSize(18).text(`${index + 1}. ${step.title}`, { underline: true });
      doc.moveDown(0.75);
      doc.fontSize(12).text(step.description || 'No description provided.');

      if (step.selector) {
        doc.moveDown(0.5);
        doc.fontSize(10).text(`Selector: ${step.selector}`);
      }

      const imageBoxWidth = 500;
      const imageBoxHeight = 620;
      const yStart = doc.y + 20;

      try {
        doc.image(Buffer.from(step.imageData), doc.page.margins.left, yStart, {
          fit: [imageBoxWidth, imageBoxHeight],
          align: 'center',
          valign: 'top'
        });
      } catch {
        doc.moveDown(1);
        doc.fontSize(12).fillColor('red').text('Could not render screenshot image in PDF.');
        doc.fillColor('black');
      }
    });

    doc.end();
  });
};

export const buildScreenshotsPdf = (screenshots) => {
  return buildWalkthroughPdf({
    title: 'Screenshots Export',
    subtitle: 'No screenshots found.',
    steps: screenshots.map((screenshot) => ({
      title: screenshot.title,
      description: screenshot.description,
      imageData: screenshot.imageData
    }))
  });
};
