// backend/src/modules/ticket/ticket.service.ts
import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import PDFDocument from 'pdfkit'
import PDFParser from 'pdf2json'
import JSZip from 'jszip'
import { TicketModel } from './ticket.model'

interface ITicketItem {
  descripcion: string
  unidadMedida: string
  cantidad: number
  precioUnitario: number
  total: number
}

let cachedLogoPngBuffer: Buffer | null = null

/**
 * Obtiene el logo corporativo desde http://neoshopimportaciones.com/logo-negro.png
 */
async function getLogoBuffer(): Promise<Buffer | null> {
  if (cachedLogoPngBuffer) return cachedLogoPngBuffer

  const localPngPath = path.join(process.cwd(), 'uploads/logo-negro.png')
  if (fs.existsSync(localPngPath)) {
    cachedLogoPngBuffer = fs.readFileSync(localPngPath)
    return cachedLogoPngBuffer
  }

  const logoUrl = 'http://neoshopimportaciones.com/logo-negro.png'
  return new Promise((resolve) => {
    const client = logoUrl.startsWith('https') ? https : http
    client
      .get(logoUrl, (res) => {
        if (res.statusCode !== 200) {
          resolve(null)
          return
        }
        const data: Buffer[] = []
        res.on('data', (chunk) => data.push(chunk))
        res.on('end', () => {
          const pngBuffer = Buffer.concat(data)
          cachedLogoPngBuffer = pngBuffer
          resolve(pngBuffer)
        })
        res.on('error', () => resolve(null))
      })
      .on('error', () => resolve(null))
  })
}

export class TicketService {
  /**
   * Extrae el texto plano decodificado del PDF y limpia el archivo temporal de inmediato
   */
  static extractTextFromPdf(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const pdfParser = new (PDFParser as any)(null, 1)

      const cleanupTempFile = () => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
          }
        } catch (err) {
          console.error('Error al limpiar archivo temporal:', err)
        }
      }

      pdfParser.on('pdfParser_dataError', (errData: any) => {
        cleanupTempFile()
        reject(errData.parserError)
      })

      pdfParser.on('pdfParser_dataReady', () => {
        const rawText = (pdfParser as any).getRawTextContent()
        cleanupTempFile()
        resolve(rawText || '')
      })

      pdfParser.loadPDF(filePath)
    })
  }

  private static cleanText(val?: string): string {
    if (!val) return ''
    const trimmed = val.trim()
    return trimmed === '--' || trimmed === '-' ? '' : trimmed
  }

  /**
   * Parsea inteligentemente cada producto separando nombres, series, cantidades y precios
   */
  private static parseItemsFromText(rawText: string): ITicketItem[] {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    const startIndex = lines.findIndex((l) => /Caja:/i.test(l))
    const endIndex = lines.findIndex((l) => /^(?:PAGOS|Subtotal|Total|----------------)/i.test(l))

    const itemLines = lines.slice(
      startIndex !== -1 ? startIndex + 1 : 0,
      endIndex !== -1 ? endIndex : lines.length
    )

    const items: ITicketItem[] = []
    let currentDescLines: string[] = []

    for (const line of itemLines) {
      if (/^(?:DESCRIPCI[ÓO]N|U\.M|CANT|PRECIO|TOTAL)/i.test(line)) continue
      if (/^https?:\/\//i.test(line)) continue
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line) && line.includes(':')) continue

      const matchNumbers = line.match(
        /^(.*?)(?:(NIU|UND|ZZ|PZA|KG|GLN)\s+)?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i
      )

      if (matchNumbers) {
        const extraText = matchNumbers[1]?.trim()
        if (extraText) {
          currentDescLines.push(extraText)
        }

        const fullDescription = currentDescLines.join('\n').trim()
        const unidadMedida = matchNumbers[2] ? matchNumbers[2].toUpperCase() : 'NIU'
        const cantidad = parseFloat(matchNumbers[3]) || 1
        const precioUnitario = parseFloat(matchNumbers[4]) || 0
        const total = parseFloat(matchNumbers[5]) || 0

        items.push({
          descripcion: fullDescription || 'PRODUCTO / SERVICIO',
          unidadMedida,
          cantidad,
          precioUnitario,
          total,
        })

        currentDescLines = []
      } else {
        currentDescLines.push(line)
      }
    }

    if (currentDescLines.length > 0 && items.length === 0) {
      items.push({
        descripcion: currentDescLines.join('\n').trim(),
        unidadMedida: 'NIU',
        cantidad: 1,
        precioUnitario: 0,
        total: 0,
      })
    }

    return items
  }

  static async parsePdfLocal(filePath: string) {
    let text = ''
    try {
      text = await this.extractTextFromPdf(filePath)
    } catch (error) {
      console.error('Error al leer PDF:', error)
    }

    const isBoleta = /BOLETA ELECTR[ÓO]NICA/i.test(text)
    const tipoComprobante = isBoleta ? 'BOLETA ELECTRÓNICA' : 'NOTA DE VENTA'
    const numNotaMatch = text.match(/(?:NOTA DE VENTA|BOLETA ELECTR[ÓO]NICA)[\s\r\n]+([A-Z0-9]+-[0-9]+)/i)

    const direccionesMatch = [...text.matchAll(/Direcci[óo]n:\s*([^\r\n]+)/gi)]
    const direccionClienteRaw = direccionesMatch[1] ? direccionesMatch[1][1] : ''

    const clienteMatch = text.match(/Nombre:\s*([^\r\n]+)/i)
    const docMatch = text.match(/DNI\/RUC:\s*([^\s\r\n]+)/i)
    const telClienteMatch = text.match(/DNI\/RUC:.*?Tel[ée]fono:\s*([^\r\n]+)/i)

    const fechaMatch = text.match(/Fecha:\s*([^\r\n]+)/i)
    const horaMatch = text.match(/Hora:\s*([^\r\n]+)/i)
    const cajeroMatch = text.match(/Cajero\(a\):\s*([^\r\n]+)/i)
    const cajaMatch = text.match(/Caja:\s*([^\r\n]+)/i)

    const subtotalMatch = text.match(/Subtotal\s*S\/\s*([0-9.,]+)/i)
    const igvMatch = text.match(/IGV\s*\(\d+%\)\s*S\/\s*([0-9.,]+)/i)
    const totalMatch =
      text.match(/Total\s*(?:Pagado)?\s*S\/\s*([0-9.,]+)/i) ||
      text.match(/Total\s*S\/\s*([0-9.,]+)/i)

    const subtotal = subtotalMatch ? parseFloat(subtotalMatch[1].replace(/,/g, '')) : 0
    const igv = igvMatch ? parseFloat(igvMatch[1].replace(/,/g, '')) : 0
    const monto = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : 0

    const items = this.parseItemsFromText(text)

    return {
      tipoComprobante,
      numeroNota: this.cleanText(numNotaMatch ? numNotaMatch[1] : ''),
      empresa: 'NEOSHOP IMPORTACIONES',
      rucEmpresa: '20613242784',
      telefonoEmpresa: '902900653',
      direccionEmpresa: 'PUEBLO LIBRE',
      cliente: this.cleanText(clienteMatch ? clienteMatch[1] : ''),
      documentoCliente: this.cleanText(docMatch ? docMatch[1] : ''),
      telefonoCliente: this.cleanText(telClienteMatch ? telClienteMatch[1] : ''),
      direccionCliente: this.cleanText(direccionClienteRaw),
      fecha: this.cleanText(fechaMatch ? fechaMatch[1] : ''),
      hora: this.cleanText(horaMatch ? horaMatch[1] : ''),
      cajero: this.cleanText(cajeroMatch ? cajeroMatch[1] : ''),
      caja: this.cleanText(cajaMatch ? cajaMatch[1] : ''),
      items,
      subtotal,
      igv,
      monto,
    }
  }

  private static async renderSingleTicketA4(
    doc: PDFKit.PDFDocument,
    ticketData: any,
    pageNumber: number = 1,
    totalPages: number = 1
  ) {
    // Dimensiones de página A4: 595.28 x 841.89 pt
    const pageWidth = 595.28
    const pageEdgeMargin = 10
    const edgeContentWidth = pageWidth - pageEdgeMargin * 2

    // 1. Textos pegados al borde superior (Y = 6)
    const topEdgeY = 6
    const headerDateText = `${ticketData.fecha || '--'} ${ticketData.hora || ''}`.trim()
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#555555')
      .text(headerDateText, pageEdgeMargin, topEdgeY, {
        align: 'left',
        width: edgeContentWidth,
      })

    const headerTitleText = `${ticketData.tipoComprobante || 'BOLETA ELECTRÓNICA'} ${ticketData.numeroNota || '--'}`.trim()
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor('#222222')
      .text(headerTitleText, pageEdgeMargin, topEdgeY, {
        align: 'center',
        width: edgeContentWidth,
      })

    // Dimensiones del contenedor central (Card)
    const cardX = 85
    const cardY = 22
    const cardWidth = 425.28
    const cardHeight = 794
    const paddingX = 24
    const contentLeft = cardX + paddingX
    const contentRight = cardX + cardWidth - paddingX
    const innerWidth = contentRight - contentLeft

    // Sombra y contenedor recto
    doc.save()
    doc.rect(cardX + 4, cardY + 4, cardWidth, cardHeight).fillColor('#000000', 0.04).fill()
    doc.rect(cardX + 2, cardY + 2, cardWidth, cardHeight).fillColor('#000000', 0.07).fill()
    doc.rect(cardX, cardY, cardWidth, cardHeight).fillColor('#FFFFFF', 1).strokeColor('#E4E4E7').lineWidth(1).fillAndStroke()
    doc.restore()

    doc.y = cardY + 14

    const drawDashedDivider = () => {
      doc.y += 4
      doc
        .save()
        .moveTo(contentLeft, doc.y)
        .lineTo(contentRight, doc.y)
        .dash(3, { space: 3 })
        .lineWidth(0.6)
        .strokeColor('#666666')
        .stroke()
        .undash()
        .restore()
      doc.y += 6
    }

    // 2. Logo corporativo
    const logoBuffer = await getLogoBuffer()
    let logoDrawn = false

    if (logoBuffer) {
      try {
        const logoWidth = 135
        doc.image(logoBuffer, contentLeft + (innerWidth - logoWidth) / 2, doc.y, { width: logoWidth })
        doc.y += 40
        logoDrawn = true
      } catch {
        logoDrawn = false
      }
    }

    if (!logoDrawn) {
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor('#000000')
        .text('NEOSHOP', contentLeft, doc.y, {
          align: 'center',
          width: innerWidth,
        })
      doc.y += 6
    }

    // 3. Encabezado interno del comprobante
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#000000')
      .text(ticketData.tipoComprobante || 'BOLETA ELECTRÓNICA', contentLeft, doc.y, {
        align: 'center',
        width: innerWidth,
      })
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(ticketData.numeroNota || '--', contentLeft, doc.y + 1.5, {
        align: 'center',
        width: innerWidth,
      })

    doc.y += 3
    drawDashedDivider()

    // Helpers de columnas
    const col1W = 185
    const col2X = contentLeft + col1W + 10
    const col2W = innerWidth - (col1W + 10)

    const printTwoColumnRow = (text1: string, text2: string, fontSize = 8, isBold = false) => {
      const startY = doc.y
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#000000')
      const h1 = doc.heightOfString(text1, { width: col1W })
      const h2 = doc.heightOfString(text2, { width: col2W })
      const maxH = Math.max(h1, h2)

      doc.text(text1, contentLeft, startY, { width: col1W })
      doc.text(text2, col2X, startY, { width: col2W })
      doc.y = startY + maxH + 2.5
    }

    const printFullWidthRow = (text: string, fontSize = 8, isBold = false) => {
      const startY = doc.y
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#000000')
      const h = doc.heightOfString(text, { width: innerWidth })
      doc.text(text, contentLeft, startY, { width: innerWidth })
      doc.y = startY + h + 2.5
    }

    // 4. Datos del Emisor
    printFullWidthRow('NEOSHOP IMPORTACIONES', 8.5, true)
    printTwoColumnRow(
      `RUC: ${ticketData.rucEmpresa || '20613242784'}`,
      `Teléfono: ${ticketData.telefonoEmpresa || '902900653'}`
    )
    printFullWidthRow(`Dirección: ${ticketData.direccionEmpresa || 'PUEBLO LIBRE'}`)
    drawDashedDivider()

    // 5. Datos del Cliente
    printFullWidthRow(`Nombre: ${ticketData.cliente || 'CLIENTE GENERAL'}`)
    printTwoColumnRow(
      `DNI/RUC: ${ticketData.documentoCliente || '--'}`,
      `Teléfono: ${ticketData.telefonoCliente || '--'}`
    )
    printFullWidthRow(`Dirección: ${ticketData.direccionCliente || '--'}`)
    drawDashedDivider()

    // 6. Metadatos de Emisión
    printTwoColumnRow(`Fecha: ${ticketData.fecha || '--'}`, `Hora: ${ticketData.hora || '--'}`)
    printTwoColumnRow(`Cajero(a): ${ticketData.cajero || '--'}`, `Caja: ${ticketData.caja || '--'}`)
    drawDashedDivider()

    // 7. Columnas de Items
    const colDescX = contentLeft
    const colDescW = 180
    const colUmX = contentLeft + 185
    const colUmW = 35
    const colCantX = contentLeft + 225
    const colCantW = 35
    const colPrecX = contentLeft + 265
    const colPrecW = 50
    const colTotX = contentLeft + 320
    const colTotW = innerWidth - 320

    const headerY = doc.y
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000')
    doc.text('DESCRIPCIÓN', colDescX, headerY, { width: colDescW })
    doc.text('U.M', colUmX, headerY, { width: colUmW, align: 'center' })
    doc.text('CANT.', colCantX, headerY, { width: colCantW, align: 'center' })
    doc.text('PRECIO', colPrecX, headerY, { width: colPrecW, align: 'right' })
    doc.text('TOTAL', colTotX, headerY, { width: colTotW, align: 'right' })

    drawDashedDivider()

    // 8. Lista de Productos
    if (Array.isArray(ticketData.items) && ticketData.items.length > 0) {
      ticketData.items.forEach((item: ITicketItem) => {
        const itemStartY = doc.y
        doc.font('Helvetica').fontSize(7.5).fillColor('#000000')

        const descHeight = doc.heightOfString(item.descripcion, {
          width: colDescW,
          lineGap: 0.5,
        })
        const rowHeight = Math.max(descHeight, 9)

        doc.text(item.descripcion, colDescX, itemStartY, {
          width: colDescW,
          lineGap: 0.5,
        })
        doc.text(item.unidadMedida || 'NIU', colUmX, itemStartY, { width: colUmW, align: 'center' })
        doc.text(String(item.cantidad), colCantX, itemStartY, { width: colCantW, align: 'center' })
        doc.text(Number(item.precioUnitario || 0).toFixed(2), colPrecX, itemStartY, {
          width: colPrecW,
          align: 'right',
        })
        doc.text(Number(item.total || 0).toFixed(2), colTotX, itemStartY, {
          width: colTotW,
          align: 'right',
        })

        doc.y = itemStartY + rowHeight + 3
      })
    } else {
      doc.font('Helvetica').fontSize(7.5).text('Sin productos registrados', colDescX, doc.y)
      doc.y += 9
    }

    drawDashedDivider()

    // 9. Totales e Impuestos
    const labelX = contentLeft + 185
    const labelW = 95
    const valX = contentLeft + 285
    const valW = innerWidth - 285

    if (ticketData.subtotal && ticketData.subtotal > 0) {
      const subY = doc.y
      doc.font('Helvetica').fontSize(8).fillColor('#000000')
      doc.text('Subtotal', labelX, subY, { width: labelW, align: 'right' })
      doc.text(`S/${Number(ticketData.subtotal).toFixed(2)}`, valX, subY, {
        width: valW,
        align: 'right',
      })
      doc.y = subY + 10
    }

    if (ticketData.igv && ticketData.igv > 0) {
      const igvY = doc.y
      doc.font('Helvetica').fontSize(8).fillColor('#000000')
      doc.text('IGV(18%)', labelX, igvY, { width: labelW, align: 'right' })
      doc.text(`S/${Number(ticketData.igv).toFixed(2)}`, valX, igvY, {
        width: valW,
        align: 'right',
      })
      doc.y = igvY + 10
    }

    const totY = doc.y
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000')
    doc.text('Total', labelX, totY, { width: labelW, align: 'right' })
    doc.text(`S/${Number(ticketData.monto || 0).toFixed(2)}`, valX, totY, {
      width: valW,
      align: 'right',
    })
    doc.y = totY + 14

    // 10. Fecha/hora central interna
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#000000')
      .text(headerDateText || '14/08/2026 04:47', contentLeft, doc.y, {
        align: 'center',
        width: innerWidth,
      })

    // 11. Textos pegados al borde inferior (Y = 828)
    const bottomEdgeY = 828
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#555555')
      .text('neoshopimportaciones.com', pageEdgeMargin, bottomEdgeY, {
        align: 'left',
        width: edgeContentWidth,
      })

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#555555')
      .text(`${pageNumber}/${totalPages}`, pageEdgeMargin, bottomEdgeY, {
        align: 'right',
        width: edgeContentWidth,
      })
  }

  static async generateTicketPdfBuffer(ticketData: any): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      const buffers: Buffer[] = []

      doc.on('data', (chunk) => buffers.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(buffers)))
      doc.on('error', (err) => reject(err))

      await this.renderSingleTicketA4(doc, ticketData, 1, 1)
      doc.end()
    })
  }

  static async generateMultipleTicketsPdfBuffer(ticketsData: any[]): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        autoFirstPage: false,
      })
      const buffers: Buffer[] = []

      doc.on('data', (chunk) => buffers.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(buffers)))
      doc.on('error', (err) => reject(err))

      const total = ticketsData.length
      for (let i = 0; i < total; i++) {
        doc.addPage()
        await this.renderSingleTicketA4(doc, ticketsData[i], i + 1, total)
      }

      doc.end()
    })
  }

  /**
   * Empaqueta cada ticket en un PDF individual dentro de un archivo ZIP usando JSZip
   */
  static async generateTicketsZipBuffer(ticketsData: any[]): Promise<Buffer> {
    const zip = new JSZip()

    for (const ticket of ticketsData) {
      const pdfBuffer = await this.generateTicketPdfBuffer(ticket)
      const sanitizedName = (ticket.numeroNota || ticket._id.toString()).replace(/[^a-zA-Z0-9-_]/g, '_')
      zip.file(`Ticket-${sanitizedName}.pdf`, pdfBuffer)
    }

    return await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    })
  }

  static async getTicketsByIds(ids: string[]) {
    return await TicketModel.find({ _id: { $in: ids } })
  }

  static async getTicketById(id: string) {
    return await TicketModel.findById(id)
  }

  static async getAllTickets(params: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = params
    const skip = (page - 1) * limit
    const query: any = {}

    if (search) {
      query.$or = [
        { cliente: { $regex: search, $options: 'i' } },
        { numeroNota: { $regex: search, $options: 'i' } },
      ]
    }

    const [data, total] = await Promise.all([
      TicketModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      TicketModel.countDocuments(query),
    ])

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    }
  }

  static async convertToSaleNote(data: any, filename?: string) {
    const newTicket = new TicketModel(data)
    await newTicket.save()

    if (filename) {
      const filePath = path.join(process.cwd(), 'uploads/temp', filename)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }

    return newTicket
  }

  static async deleteTicket(id: string) {
    return await TicketModel.findByIdAndDelete(id)
  }
}