import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';

const pdfDoc = await PDFDocument.create();
const page = pdfDoc.addPage([612, 792]);
const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
page.drawText('Hello PDF OCR Test Page 1', { x: 50, y: 700, size: 24, font: helvetica, color: rgb(0, 0, 0) });

const page2 = pdfDoc.addPage([612, 792]);
page2.drawText('Hello PDF OCR Test Page 2', { x: 50, y: 700, size: 24, font: helvetica, color: rgb(0, 0, 0) });

fs.writeFileSync('test_sample.pdf', await pdfDoc.save());
console.log('Created test_sample.pdf');
