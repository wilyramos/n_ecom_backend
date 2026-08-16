// backend/src/modules/ticket/ticket.service.ts
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import PDFDocument from 'pdfkit';
import PDFParser from 'pdf2json';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import { TicketModel } from './ticket.model';

interface ITicketItem {
  descripcion: string;
  unidadMedida: string;
  cantidad: number;
  precioUnitario: number;
  total: number;
}

let cachedLogoPngBuffer: Buffer | null = null;

/**
 * Obtiene el logo corporativo desde https://www.neoshopimportaciones.com/neoshop-negro.png
 */
async function getLogoBuffer(): Promise<Buffer | null> {
  if (cachedLogoPngBuffer) return cachedLogoPngBuffer;

  const localPngPath = path.join(process.cwd(), 'uploads/neoshop-negro.png');
  if (fs.existsSync(localPngPath)) {
    cachedLogoPngBuffer = fs.readFileSync(localPngPath);
    return cachedLogoPngBuffer;
  }

  const logoUrl = 'https://www.neoshopimportaciones.com/neoshop-negro.png';
  return new Promise((resolve) => {
    const client = logoUrl.startsWith('https') ? https : http;
    client
      .get(logoUrl, (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        const data: Buffer[] = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => {
          const pngBuffer = Buffer.concat(data);
          cachedLogoPngBuffer = pngBuffer;
          resolve(pngBuffer);
        });
        res.on('error', () => resolve(null));
      })
      .on('error', () => resolve(null));
  });
}

/**
 * Convierte un número a su representación literal en soles peruanos
 */
function numeroALetrasSoles(monto: number): string {
  const unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const decenas = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const diezY = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
  const veinti = ['', 'VEINTIUNO', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  const entero = Math.floor(monto);
  const centavos = Math.round((monto - entero) * 100).toString().padStart(2, '0');

  function convertirGrupo(n: number): string {
    let out = '';
    const c = Math.floor(n / 100);
    const d = Math.floor((n % 100) / 10);
    const u = n % 10;

    if (n === 100) return 'CIEN';
    if (c > 0) out += centenas[c] + ' ';

    if (d === 1) {
      out += diezY[u];
    } else if (d === 2) {
      out += u === 0 ? 'VEINTE' : veinti[u];
    } else if (d > 2) {
      out += decenas[d] + (u > 0 ? ' Y ' + unidades[u] : '');
    } else if (u > 0) {
      out += unidades[u];
    }
    return out.trim();
  }

  if (entero === 0) return `CERO CON ${centavos}/100 SOLES`;

  const miles = Math.floor(entero / 1000);
  const resto = entero % 1000;

  let texto = '';
  if (miles === 1) texto += 'MIL ';
  else if (miles > 1) texto += convertirGrupo(miles) + ' MIL ';

  if (resto > 0) texto += convertirGrupo(resto);

  return `${texto.trim()} CON ${centavos}/100 SOLES`;
}

export class TicketService {
  static extractTextFromPdf(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const pdfParser = new (PDFParser as any)(null, 1);

      const cleanupTempFile = () => {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Error al limpiar archivo temporal:', err);
        }
      };

      pdfParser.on('pdfParser_dataError', (errData: any) => {
        cleanupTempFile();
        reject(errData.parserError);
      });

      pdfParser.on('pdfParser_dataReady', () => {
        const rawText = (pdfParser as any).getRawTextContent();
        cleanupTempFile();
        resolve(rawText || '');
      });

      pdfParser.loadPDF(filePath);
    });
  }

  private static cleanText(val?: string): string {
    if (!val) return '';
    let text = val.replace(/[\t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    text = text.replace(/\s+,/g, ',').replace(/,\s{2,}/g, ', ');
    return text === '--' || text === '-' ? '' : text;
  }

  private static calculateTaxes(items: ITicketItem[], totalDirecto?: number) {
    let total = totalDirecto && totalDirecto > 0 ? totalDirecto : 0;

    if (Array.isArray(items) && items.length > 0) {
      const sumItems = items.reduce((acc, curr) => acc + (Number(curr.total) || 0), 0);
      if (sumItems > 0) {
        total = Number(sumItems.toFixed(2));
      }
    }

    const subtotal = Number((total / 1.18).toFixed(2));
    const igv = Number((total - subtotal).toFixed(2));

    return {
      subtotal,
      igv,
      monto: total,
    };
  }

  private static parseItemsFromText(rawText: string): ITicketItem[] {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const startIndex = lines.findIndex((l) => /Caja:/i.test(l));
    const endIndex = lines.findIndex((l) => /^(?:PAGOS|Subtotal|Total|----------------)/i.test(l));

    const itemLines = lines.slice(
      startIndex !== -1 ? startIndex + 1 : 0,
      endIndex !== -1 ? endIndex : lines.length
    );

    const items: ITicketItem[] = [];
    let currentDescLines: string[] = [];

    for (const line of itemLines) {
      if (/^(?:DESCRIPCI[ÓO]N|U\.M|CANT|PRECIO|TOTAL)/i.test(line)) continue;
      if (/^https?:\/\//i.test(line)) continue;
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line) && line.includes(':')) continue;

      const matchNumbers = line.match(
        /^(.*?)(?:(NIU|UND|ZZ|PZA|KG|GLN)\s+)?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i
      );

      if (matchNumbers) {
        const extraText = matchNumbers[1]?.trim();
        if (extraText) currentDescLines.push(extraText);

        const fullDescription = this.cleanText(currentDescLines.join(' '));
        const unidadMedida = matchNumbers[2] ? matchNumbers[2].toUpperCase() : 'NIU';
        const cantidad = parseFloat(matchNumbers[3]) || 1;
        const precioUnitario = parseFloat(matchNumbers[4]) || 0;
        const total = parseFloat(matchNumbers[5]) || Number((cantidad * precioUnitario).toFixed(2));

        items.push({
          descripcion: fullDescription || 'PRODUCTO / SERVICIO',
          unidadMedida,
          cantidad,
          precioUnitario,
          total,
        });

        currentDescLines = [];
      } else {
        currentDescLines.push(line);
      }
    }

    if (currentDescLines.length > 0 && items.length === 0) {
      items.push({
        descripcion: this.cleanText(currentDescLines.join(' ')),
        unidadMedida: 'NIU',
        cantidad: 1,
        precioUnitario: 0,
        total: 0,
      });
    }

    return items;
  }

  static async parsePdfLocal(filePath: string) {
    let text = '';
    try {
      text = await this.extractTextFromPdf(filePath);
    } catch (error) {
      console.error('Error al leer PDF:', error);
    }

    const isBoleta = /BOLETA ELECTR[ÓO]NICA/i.test(text);
    const tipoComprobante = isBoleta ? 'BOLETA ELECTRÓNICA' : 'NOTA DE VENTA';
    const numNotaMatch = text.match(/(?:NOTA DE VENTA|BOLETA ELECTR[ÓO]NICA)[\s\r\n]+([A-Z0-9]+-[0-9]+)/i);

    const clienteMatch = text.match(/Nombre:\s*([^\r\n]+)/i);
    let clienteRaw = clienteMatch ? clienteMatch[1] : '';
    clienteRaw = clienteRaw.replace(/Tel[ée]fono:.*$/i, '').replace(/DNI\/RUC:.*$/i, '');

    const direccionesMatch = [...text.matchAll(/Direcci[óo]n:\s*([^\r\n]+)/gi)];
    let direccionClienteRaw = '';
    if (direccionesMatch.length > 1) {
      direccionClienteRaw = direccionesMatch[1][1];
    } else if (direccionesMatch.length === 1) {
      const matchText = direccionesMatch[0][1];
      direccionClienteRaw = /PUEBLO LIBRE/i.test(matchText) ? '' : matchText;
    }
    direccionClienteRaw = direccionClienteRaw.replace(/Fecha:.*$/i, '').replace(/Cajero.*$/i, '');

    const docMatch = text.match(/DNI\/RUC:\s*([^\s\r\n]+)/i);
    const telClienteMatch = text.match(/(?:DNI\/RUC:[^\r\n]*?)?Tel[ée]fono:\s*([^\s\r\n]+)/i);

    const fechaHoraMatch = text.match(/Fecha:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})(?:[^\r\n]*?Hora:\s*([0-9:APMapm\s]+))?/i);
    const fechaRaw = fechaHoraMatch ? fechaHoraMatch[1] : '';
    let horaRaw = fechaHoraMatch && fechaHoraMatch[2] ? fechaHoraMatch[2] : '';

    if (!horaRaw) {
      const horaMatch = text.match(/Hora:\s*([0-9:APMapm\s]+)/i);
      horaRaw = horaMatch ? horaMatch[1] : '';
    }

    const cajeroMatch = text.match(/Cajero\(a\):\s*([^:\r\n]+?)(?=\s+Caja:|$)/i);
    const cajaMatch = text.match(/Caja:\s*([^\r\n]+)/i);

    const totalMatch =
      text.match(/Total\s*(?:Pagado)?\s*S\/\s*([0-9.,]+)/i) ||
      text.match(/Total\s*S\/\s*([0-9.,]+)/i);

    const montoCrudo = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : 0;
    const items = this.parseItemsFromText(text);

    const { subtotal, igv, monto } = this.calculateTaxes(items, montoCrudo);

    return {
      tipoComprobante,
      numeroNota: this.cleanText(numNotaMatch ? numNotaMatch[1] : ''),
      empresa: 'NEOSHOP IMPORTACIONES',
      rucEmpresa: '20613242784',
      telefonoEmpresa: '902900653',
      direccionEmpresa: 'PUEBLO LIBRE',
      cliente: this.cleanText(clienteRaw),
      documentoCliente: this.cleanText(docMatch ? docMatch[1] : ''),
      telefonoCliente: this.cleanText(telClienteMatch ? telClienteMatch[1] : ''),
      direccionCliente: this.cleanText(direccionClienteRaw),
      fecha: this.cleanText(fechaRaw),
      hora: this.cleanText(horaRaw),
      cajero: this.cleanText(cajeroMatch ? cajeroMatch[1] : ''),
      caja: this.cleanText(cajaMatch ? cajaMatch[1] : ''),
      items,
      subtotal,
      igv,
      monto,
    };
  }

  // ==========================================
  // FORMATO 1: TICKET A4 (ESTILO RECIBO)
  // ==========================================
  private static async renderSingleTicketA4(
    doc: PDFKit.PDFDocument,
    ticketData: any,
    pageNumber: number = 1,
    totalPages: number = 1
  ) {
    const pageWidth = 595.28;
    const pageEdgeMargin = 10;
    const edgeContentWidth = pageWidth - pageEdgeMargin * 2;

    const topEdgeY = 6;
    const headerDateText = `${ticketData.fecha || '--'} ${ticketData.hora || ''}`.trim();
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#555555')
      .text(headerDateText, pageEdgeMargin, topEdgeY, { align: 'left', width: edgeContentWidth });

    const headerTitleText = `${ticketData.tipoComprobante || 'BOLETA ELECTRÓNICA'} ${ticketData.numeroNota || '--'}`.trim();
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor('#222222')
      .text(headerTitleText, pageEdgeMargin, topEdgeY, { align: 'center', width: edgeContentWidth });

    const cardX = 85;
    const cardY = 22;
    const cardWidth = 425.28;
    const cardHeight = 794;
    const paddingX = 24;
    const contentLeft = cardX + paddingX;
    const contentRight = cardX + cardWidth - paddingX;
    const innerWidth = contentRight - contentLeft;

    doc.save();
    doc.rect(cardX + 4, cardY + 4, cardWidth, cardHeight).fillColor('#000000', 0.04).fill();
    doc.rect(cardX + 2, cardY + 2, cardWidth, cardHeight).fillColor('#000000', 0.07).fill();
    doc.rect(cardX, cardY, cardWidth, cardHeight).fillColor('#FFFFFF', 1).strokeColor('#E4E4E7').lineWidth(1).fillAndStroke();
    doc.restore();

    // Cursor vertical estrictamente controlado para evitar solapamientos
    let cursorY = cardY + 16;

    const drawDashedDivider = () => {
      cursorY += 4;
      doc.save().moveTo(contentLeft, cursorY).lineTo(contentRight, cursorY).dash(3, { space: 3 }).lineWidth(0.6).strokeColor('#666666').stroke().undash().restore();
      cursorY += 6;
    };

    const logoBuffer = await getLogoBuffer();
    const logoWidth = 120;
    const logoHeight = 36;
    const logoX = contentLeft + (innerWidth - logoWidth) / 2;

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, logoX, cursorY, { width: logoWidth, height: logoHeight, fit: [logoWidth, logoHeight], align: 'center' });
        cursorY += logoHeight + 10;
      } catch {
        doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000').text('NEOSHOP', contentLeft, cursorY, { align: 'center', width: innerWidth });
        cursorY += 22;
      }
    } else {
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000').text('NEOSHOP', contentLeft, cursorY, { align: 'center', width: innerWidth });
      cursorY += 22;
    }

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(ticketData.tipoComprobante || 'BOLETA ELECTRÓNICA', contentLeft, cursorY, { align: 'center', width: innerWidth });
    cursorY += 14;

    doc.font('Helvetica-Bold').fontSize(10).text(ticketData.numeroNota || '--', contentLeft, cursorY, { align: 'center', width: innerWidth });
    cursorY += 12;

    drawDashedDivider();

    const col1W = 185;
    const col2X = contentLeft + col1W + 10;
    const col2W = innerWidth - (col1W + 10);

    const printTwoColumnRow = (text1: string, text2: string, fontSize = 8, isBold = false) => {
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#000000');
      const h1 = doc.heightOfString(text1, { width: col1W });
      const h2 = doc.heightOfString(text2, { width: col2W });
      const maxH = Math.max(h1, h2);
      doc.text(text1, contentLeft, cursorY, { width: col1W });
      doc.text(text2, col2X, cursorY, { width: col2W });
      cursorY += maxH + 2.5;
    };

    const printFullWidthRow = (text: string, fontSize = 8, isBold = false) => {
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#000000');
      const h = doc.heightOfString(text, { width: innerWidth });
      doc.text(text, contentLeft, cursorY, { width: innerWidth });
      cursorY += h + 2.5;
    };

    printFullWidthRow('NEOSHOP IMPORTACIONES', 8.5, true);
    printTwoColumnRow(`RUC: ${ticketData.rucEmpresa || '20613242784'}`, `Teléfono: ${ticketData.telefonoEmpresa || '902900653'}`);
    printFullWidthRow(`Dirección: ${ticketData.direccionEmpresa || 'PUEBLO LIBRE'}`);
    drawDashedDivider();

    printFullWidthRow(`Nombre: ${ticketData.cliente || 'CLIENTE GENERAL'}`);
    printTwoColumnRow(`DNI/RUC: ${ticketData.documentoCliente || '--'}`, `Teléfono: ${ticketData.telefonoCliente || '--'}`);
    printFullWidthRow(`Dirección: ${ticketData.direccionCliente || '--'}`);
    drawDashedDivider();

    printTwoColumnRow(`Fecha: ${ticketData.fecha || '--'}`, `Hora: ${ticketData.hora || '--'}`);
    printTwoColumnRow(`Cajero(a): ${ticketData.cajero || '--'}`, `Caja: ${ticketData.caja || '--'}`);
    drawDashedDivider();

    const colDescX = contentLeft;
    const colDescW = 180;
    const colUmX = contentLeft + 185;
    const colUmW = 35;
    const colCantX = contentLeft + 225;
    const colCantW = 35;
    const colPrecX = contentLeft + 265;
    const colPrecW = 50;
    const colTotX = contentLeft + 320;
    const colTotW = innerWidth - 320;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');
    doc.text('DESCRIPCIÓN', colDescX, cursorY, { width: colDescW });
    doc.text('U.M', colUmX, cursorY, { width: colUmW, align: 'center' });
    doc.text('CANT.', colCantX, cursorY, { width: colCantW, align: 'center' });
    doc.text('PRECIO', colPrecX, cursorY, { width: colPrecW, align: 'right' });
    doc.text('TOTAL', colTotX, cursorY, { width: colTotW, align: 'right' });
    cursorY += 10;
    drawDashedDivider();

    if (Array.isArray(ticketData.items) && ticketData.items.length > 0) {
      ticketData.items.forEach((item: ITicketItem) => {
        doc.font('Helvetica').fontSize(7.5).fillColor('#000000');
        const descHeight = doc.heightOfString(item.descripcion, { width: colDescW, lineGap: 0.5 });
        const rowHeight = Math.max(descHeight, 9);

        doc.text(item.descripcion, colDescX, cursorY, { width: colDescW, lineGap: 0.5 });
        doc.text(item.unidadMedida || 'NIU', colUmX, cursorY, { width: colUmW, align: 'center' });
        doc.text(String(item.cantidad), colCantX, cursorY, { width: colCantW, align: 'center' });
        doc.text(Number(item.precioUnitario || 0).toFixed(2), colPrecX, cursorY, { width: colPrecW, align: 'right' });
        doc.text(Number(item.total || 0).toFixed(2), colTotX, cursorY, { width: colTotW, align: 'right' });

        cursorY += rowHeight + 3;
      });
    } else {
      doc.font('Helvetica').fontSize(7.5).text('Sin productos registrados', colDescX, cursorY);
      cursorY += 10;
    }

    drawDashedDivider();

    const taxes = this.calculateTaxes(ticketData.items, Number(ticketData.monto || 0));

    const labelX = contentLeft + 185;
    const labelW = 95;
    const valX = contentLeft + 285;
    const valW = innerWidth - 285;

    if (taxes.subtotal > 0) {
      doc.font('Helvetica').fontSize(8).fillColor('#000000');
      doc.text('Subtotal', labelX, cursorY, { width: labelW, align: 'right' });
      doc.text(`S/${taxes.subtotal.toFixed(2)}`, valX, cursorY, { width: valW, align: 'right' });
      cursorY += 10;
    }

    if (taxes.igv > 0) {
      doc.font('Helvetica').fontSize(8).fillColor('#000000');
      doc.text('IGV(18%)', labelX, cursorY, { width: labelW, align: 'right' });
      doc.text(`S/${taxes.igv.toFixed(2)}`, valX, cursorY, { width: valW, align: 'right' });
      cursorY += 10;
    }

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000');
    doc.text('Total', labelX, cursorY, { width: labelW, align: 'right' });
    doc.text(`S/${taxes.monto.toFixed(2)}`, valX, cursorY, { width: valW, align: 'right' });
    cursorY += 16;

    doc.font('Helvetica').fontSize(7.5).fillColor('#000000').text(headerDateText || '14/08/2026 04:47', contentLeft, cursorY, { align: 'center', width: innerWidth });

    const bottomEdgeY = 828;
    doc.font('Helvetica').fontSize(7).fillColor('#555555').text('neoshopimportaciones.com', pageEdgeMargin, bottomEdgeY, { align: 'left', width: edgeContentWidth });
    doc.font('Helvetica').fontSize(7).fillColor('#555555').text(`${pageNumber}/${totalPages}`, pageEdgeMargin, bottomEdgeY, { align: 'right', width: edgeContentWidth });
  }

  // ==========================================
  // FORMATO 2: FACTURA / BOLETA PROFESIONAL A4 CON QR SUNAT
  // ==========================================
  private static async renderProfessionalInvoiceA4(
    doc: PDFKit.PDFDocument,
    ticketData: any
  ) {
    const leftMargin = 38;
    const rightMargin = 557.28;
    const contentWidth = rightMargin - leftMargin;

    const logoBuffer = await getLogoBuffer();
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, leftMargin, 36, { width: 44, height: 44, fit: [44, 44] });
      } catch {}
    }

    const companyInfoX = leftMargin + 54;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('NEOSHOP IMPORTACIONES', companyInfoX, 36);
    doc.font('Helvetica').fontSize(7.5).fillColor('#444444').text('PUEBLO LIBRE', companyInfoX, 50);
    doc.text('neoshopimportaciones@gmail.com | 902900653 | www.neoshopimportaciones.com', companyInfoX, 61);

    const boxX = 390;
    const boxY = 32;
    const boxW = 167;
    const boxH = 68;

    doc.save();
    doc.rect(boxX, boxY, boxW, boxH).dash(2, { space: 2 }).lineWidth(0.8).strokeColor('#000000').stroke().undash();
    doc.restore();

    const tipoDoc = ticketData.tipoComprobante || 'BOLETA ELECTRÓNICA';
    const rucEmisor = `R.U.C. N° ${ticketData.rucEmpresa || '20613242784'}`;
    const numDoc = ticketData.numeroNota || 'B001-00001';

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000').text(tipoDoc, boxX, boxY + 12, { align: 'center', width: boxW });
    doc.font('Helvetica-Bold').fontSize(9).text(rucEmisor, boxX, boxY + 27, { align: 'center', width: boxW });
    doc.font('Helvetica-Bold').fontSize(11).text(numDoc, boxX, boxY + 42, { align: 'center', width: boxW });

    let currentY = 112;
    const labelW = 75;
    const valueX = leftMargin + labelW + 6;

    const drawInfoRow = (label: string, value: string, yPos: number, rightLabel?: string, rightValue?: string): number => {
      const leftValW = rightLabel ? 240 : contentWidth - labelW - 10;
      const hLeft = doc.heightOfString(value, { width: leftValW });
      const rowHeight = Math.max(hLeft, 14);

      doc.save().rect(leftMargin, yPos - 3, labelW, rowHeight).fillColor('#F8FAFC').fill().restore();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#006699').text(label, leftMargin + 4, yPos);
      doc.font('Helvetica').fontSize(7.5).fillColor('#000000').text(value, valueX, yPos, { width: leftValW });

      if (rightLabel && rightValue) {
        const rightLabelX = 425;
        doc.save().rect(rightLabelX, yPos - 3, 50, rowHeight).fillColor('#F8FAFC').fill().restore();
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#006699').text(rightLabel, rightLabelX + 4, yPos);
        doc.font('Helvetica').fontSize(7.5).fillColor('#000000').text(rightValue, rightLabelX + 58, yPos, { width: 70 });
      }
      doc.save().moveTo(leftMargin, yPos + rowHeight).lineTo(rightMargin, yPos + rowHeight).lineWidth(0.5).strokeColor('#E2E8F0').stroke().restore();
      return yPos + rowHeight + 4;
    };

    currentY = drawInfoRow('Cliente', ticketData.cliente || 'CLIENTE GENERAL', currentY, 'Moneda', 'S/');
    currentY = drawInfoRow('L.E / DNI', ticketData.documentoCliente || '--', currentY);
    currentY = drawInfoRow('Dirección', ticketData.direccionCliente || '--', currentY);

    const metaY = currentY + 6;
    const metaCols = [
      { label: 'F. Emisión', val: ticketData.fecha || '--', x: leftMargin, w: 100 },
      { label: 'F. Vencimiento', val: ticketData.fecha || '--', x: leftMargin + 110, w: 100 },
      { label: 'Forma de pago', val: 'Contado', x: leftMargin + 230, w: 100 },
      { label: '# Orden de compra', val: '--', x: leftMargin + 360, w: 120 },
    ];

    doc.save().rect(leftMargin, metaY - 3, contentWidth, 14).fillColor('#F8FAFC').fill().restore();
    metaCols.forEach((col) => {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#006699').text(col.label, col.x + 4, metaY);
      doc.font('Helvetica').fontSize(7.5).fillColor('#000000').text(col.val, col.x + 4, metaY + 15);
    });
    doc.save().moveTo(leftMargin, metaY + 28).lineTo(rightMargin, metaY + 28).lineWidth(1).strokeColor('#006699').stroke().restore();

    const tableHeaderY = metaY + 36;
    const colTDescX = leftMargin + 4;
    const colTDescW = 210;
    const colTUmX = 265;
    const colTUmW = 45;
    const colTCantX = 315;
    const colTCantW = 45;
    const colTPrecX = 365;
    const colTPrecW = 55;
    const colTDtoX = 425;
    const colTDtoW = 40;
    const colTTotX = 470;
    const colTTotW = 49;

    doc.save().rect(leftMargin, tableHeaderY - 4, contentWidth, 15).fillColor('#F8FAFC').fill().restore();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#006699');
    doc.text('Descripción', colTDescX, tableHeaderY, { width: colTDescW });
    doc.text('Unidad', colTUmX, tableHeaderY, { width: colTUmW, align: 'center' });
    doc.text('Cant.', colTCantX, tableHeaderY, { width: colTCantW, align: 'center' });
    doc.text('Precio', colTPrecX, tableHeaderY, { width: colTPrecW, align: 'right' });
    doc.text('Dto.', colTDtoX, tableHeaderY, { width: colTDtoW, align: 'center' });
    doc.text('Total', colTTotX, tableHeaderY, { width: colTTotW, align: 'right' });

    doc.save().moveTo(leftMargin, tableHeaderY + 13).lineTo(rightMargin, tableHeaderY + 13).lineWidth(1).strokeColor('#006699').stroke().restore();

    let itemCurrentY = tableHeaderY + 18;
    if (Array.isArray(ticketData.items) && ticketData.items.length > 0) {
      ticketData.items.forEach((item: ITicketItem) => {
        const itemStartY = itemCurrentY;
        doc.font('Helvetica').fontSize(7).fillColor('#000000');

        const descHeight = doc.heightOfString(item.descripcion, { width: colTDescW, lineGap: 1 });
        const rowH = Math.max(descHeight, 10);

        doc.text(item.descripcion, colTDescX, itemStartY, { width: colTDescW, lineGap: 1 });
        doc.text(item.unidadMedida || 'NIU', colTUmX, itemStartY, { width: colTUmW, align: 'center' });
        doc.text(String(item.cantidad), colTCantX, itemStartY, { width: colTCantW, align: 'center' });
        doc.text(Number(item.precioUnitario || 0).toFixed(2), colTPrecX, itemStartY, { width: colTPrecW, align: 'right' });
        doc.text('--', colTDtoX, itemStartY, { width: colTDtoW, align: 'center' });
        doc.text(Number(item.total || 0).toFixed(2), colTTotX, itemStartY, { width: colTTotW, align: 'right' });

        itemCurrentY = itemStartY + rowH + 6;
      });
    }

    const totalsStartY = Math.max(itemCurrentY + 8, 360);
    const tLabelX = 350;
    const tLabelW = 90;
    const tValX = 445;
    const tValW = 74;

    const taxes = this.calculateTaxes(ticketData.items, Number(ticketData.monto || 0));

    doc.font('Helvetica').fontSize(7.5).fillColor('#000000');
    doc.text('Op.Gravada: S/', tLabelX, totalsStartY, { width: tLabelW, align: 'right' });
    doc.text(`S/${taxes.subtotal.toFixed(2)}`, tValX, totalsStartY, { width: tValW, align: 'right' });

    doc.text('IGV(18%)', tLabelX, totalsStartY + 12, { width: tLabelW, align: 'right' });
    doc.text(`S/${taxes.igv.toFixed(2)}`, tValX, totalsStartY + 12, { width: tValW, align: 'right' });

    doc.font('Helvetica-Bold').fontSize(8.5);
    doc.text('Importe Total:', tLabelX, totalsStartY + 25, { width: tLabelW, align: 'right' });
    doc.text(`S/${taxes.monto.toFixed(2)}`, tValX, totalsStartY + 25, { width: tValW, align: 'right' });

    const letrasY = totalsStartY + 45;
    const totalEnLetras = numeroALetrasSoles(taxes.monto);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000').text(totalEnLetras, leftMargin, letrasY);
    doc.save().moveTo(leftMargin, letrasY + 11).lineTo(rightMargin, letrasY + 11).lineWidth(0.8).strokeColor('#006699').stroke().restore();

    const obsY = letrasY + 16;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000').text('Observaciones:', leftMargin, obsY);
    doc.font('Helvetica').fontSize(7).text('Gracias por su compra.', leftMargin, obsY + 10);
    doc.save().moveTo(leftMargin, obsY + 23).lineTo(rightMargin, obsY + 23).lineWidth(0.8).strokeColor('#006699').stroke().restore();

    const footerY = obsY + 34;
    const qrText = `20613242784|03|${numDoc}|${taxes.igv.toFixed(2)}|${taxes.monto.toFixed(2)}|${ticketData.fecha || ''}|1|${ticketData.documentoCliente || ''}|`;

    try {
      const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 1, width: 90 });
      const qrImageBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
      doc.image(qrImageBuffer, leftMargin, footerY, { width: 75 });
    } catch {}

    const textFooterX = leftMargin + 85;
    doc.font('Helvetica').fontSize(7).fillColor('#333333');
    doc.text(`Representación Impresa de la ${tipoDoc}.`, textFooterX, footerY + 16);
    doc.font('Helvetica-Bold').text(`Sunat: `, textFooterX, footerY + 28, { continued: true });
    doc.font('Helvetica').text(`La Boleta numero ${numDoc}, ha sido aceptada.`);
  }

  static async generateTicketPdfBuffer(ticketData: any): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      await this.renderSingleTicketA4(doc, ticketData, 1, 1);
      doc.end();
    });
  }

  static async generateMultipleTicketsPdfBuffer(ticketsData: any[]): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 }, autoFirstPage: false });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const total = ticketsData.length;
      for (let i = 0; i < total; i++) {
        doc.addPage();
        await this.renderSingleTicketA4(doc, ticketsData[i], i + 1, total);
      }
      doc.end();
    });
  }

  static async generateProfessionalPdfBuffer(ticketData: any): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 30, bottom: 30, left: 38, right: 38 } });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      await this.renderProfessionalInvoiceA4(doc, ticketData);
      doc.end();
    });
  }

  static async generateMultipleProfessionalPdfBuffer(ticketsData: any[]): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 30, bottom: 30, left: 38, right: 38 }, autoFirstPage: false });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      for (const ticket of ticketsData) {
        doc.addPage();
        await this.renderProfessionalInvoiceA4(doc, ticket);
      }
      doc.end();
    });
  }

  static async generateTicketsZipBuffer(ticketsData: any[], format: 'ticket' | 'professional' = 'ticket'): Promise<Buffer> {
    const zip = new JSZip();

    for (const ticket of ticketsData) {
      const pdfBuffer = format === 'professional'
        ? await this.generateProfessionalPdfBuffer(ticket)
        : await this.generateTicketPdfBuffer(ticket);
      const sanitizedName = (ticket.numeroNota || ticket._id.toString()).replace(/[^a-zA-Z0-9-_]/g, '_');
      zip.file(`Comprobante-${sanitizedName}.pdf`, pdfBuffer);
    }

    return await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
  }

  static async getTicketsByIds(ids: string[]) {
    return await TicketModel.find({ _id: { $in: ids } });
  }

  static async getTicketById(id: string) {
    return await TicketModel.findById(id);
  }

  static async getAllTickets(params: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = params;
    const skip = (page - 1) * limit;
    const query: any = {};

    if (search) {
      query.$or = [
        { cliente: { $regex: search, $options: 'i' } },
        { numeroNota: { $regex: search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      TicketModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      TicketModel.countDocuments(query),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  static async convertToSaleNote(data: any, filename?: string) {
    const sanitizedItems = Array.isArray(data.items)
      ? data.items.map((item: ITicketItem) => {
          const cantidad = Number(item.cantidad) || 1;
          const precioUnitario = Number(item.precioUnitario) || 0;
          const total = Number(item.total) || Number((cantidad * precioUnitario).toFixed(2));
          return {
            ...item,
            descripcion: this.cleanText(item.descripcion),
            unidadMedida: this.cleanText(item.unidadMedida) || 'NIU',
            cantidad,
            precioUnitario,
            total,
          };
        })
      : [];

    const { subtotal, igv, monto } = this.calculateTaxes(sanitizedItems, Number(data.monto || 0));

    const sanitizedData = {
      ...data,
      cliente: this.cleanText(data.cliente),
      numeroNota: this.cleanText(data.numeroNota),
      tipoComprobante: this.cleanText(data.tipoComprobante),
      documentoCliente: this.cleanText(data.documentoCliente),
      telefonoCliente: this.cleanText(data.telefonoCliente),
      direccionCliente: this.cleanText(data.direccionCliente),
      fecha: this.cleanText(data.fecha),
      hora: this.cleanText(data.hora),
      cajero: this.cleanText(data.cajero),
      caja: this.cleanText(data.caja),
      items: sanitizedItems,
      subtotal,
      igv,
      monto,
    };

    const newTicket = new TicketModel(sanitizedData);
    await newTicket.save();

    if (filename) {
      const filePath = path.join(process.cwd(), 'uploads/temp', filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    return newTicket;
  }

  static async updateTicket(id: string, data: any) {
    const sanitizedItems = Array.isArray(data.items)
      ? data.items.map((item: ITicketItem) => {
          const cantidad = Number(item.cantidad) || 1;
          const precioUnitario = Number(item.precioUnitario) || 0;
          const total = Number(item.total) || Number((cantidad * precioUnitario).toFixed(2));
          return {
            ...item,
            descripcion: this.cleanText(item.descripcion),
            unidadMedida: this.cleanText(item.unidadMedida) || 'NIU',
            cantidad,
            precioUnitario,
            total,
          };
        })
      : [];

    const { subtotal, igv, monto } = this.calculateTaxes(sanitizedItems, Number(data.monto || 0));

    const sanitizedData = {
      ...data,
      cliente: this.cleanText(data.cliente),
      numeroNota: this.cleanText(data.numeroNota),
      tipoComprobante: this.cleanText(data.tipoComprobante),
      documentoCliente: this.cleanText(data.documentoCliente),
      telefonoCliente: this.cleanText(data.telefonoCliente),
      direccionCliente: this.cleanText(data.direccionCliente),
      fecha: this.cleanText(data.fecha),
      hora: this.cleanText(data.hora),
      cajero: this.cleanText(data.cajero),
      caja: this.cleanText(data.caja),
      items: sanitizedItems,
      subtotal,
      igv,
      monto,
    };

    const updated = await TicketModel.findByIdAndUpdate(id, sanitizedData, { new: true });
    return updated;
  }

  static async deleteTicket(id: string) {
    return await TicketModel.findByIdAndDelete(id);
  }
}