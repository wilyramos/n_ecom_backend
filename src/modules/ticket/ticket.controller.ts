// backend/src/modules/ticket/ticket.controller.ts
import { Request, Response, NextFunction } from 'express'
import { TicketService } from './ticket.service'

function resolvePdfFileName(ticket: any, fallbackPrefix: string): string {
  if (ticket.originalFilename && ticket.originalFilename.trim() !== '') {
    const raw = ticket.originalFilename.trim()
    return raw.toLowerCase().endsWith('.pdf') ? raw : `${raw}.pdf`
  }
  const sanitizedNumero = (ticket.numeroNota || ticket._id.toString()).replace(/[^a-zA-Z0-9-_]/g, '_')
  return `${fallbackPrefix}-${sanitizedNumero}.pdf`
}

export const getTickets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || 10
    const search = req.query.search as string

    const result = await TicketService.getAllTickets({ page, limit, search })

    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    })
  } catch (error) {
    next(error)
  }
}

export const getTicketById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    const ticket = await TicketService.getTicketById(id)
    if (!ticket) {
      res.status(404).json({ success: false, message: 'Ticket no encontrado' })
      return
    }
    res.status(200).json({ success: true, data: ticket })
  } catch (error) {
    next(error)
  }
}

export const downloadTicketPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    const ticket = await TicketService.getTicketById(id)
    if (!ticket) {
      res.status(404).json({ success: false, message: 'Ticket no encontrado' })
      return
    }

    const pdfBuffer = await TicketService.generateTicketPdfBuffer(ticket)
    const fileName = resolvePdfFileName(ticket, 'ticket')

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
    res.setHeader('X-Filename', fileName)
    res.send(pdfBuffer)
  } catch (error) {
    next(error)
  }
}

export const downloadProfessionalPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    const ticket = await TicketService.getTicketById(id)
    if (!ticket) {
      res.status(404).json({ success: false, message: 'Comprobante no encontrado' })
      return
    }

    const pdfBuffer = await TicketService.generateProfessionalPdfBuffer(ticket)
    const fileName = resolvePdfFileName(ticket, 'boleta-electronica')

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
    res.setHeader('X-Filename', fileName)
    res.send(pdfBuffer)
  } catch (error) {
    next(error)
  }
}

export const bulkPrintTicketsPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { ids, format } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, message: 'Lista de IDs no proporcionada.' })
      return
    }

    const tickets = await TicketService.getTicketsByIds(ids)
    if (tickets.length === 0) {
      res.status(404).json({ success: false, message: 'No se encontraron tickets.' })
      return
    }

    const pdfBuffer = format === 'professional'
      ? await TicketService.generateMultipleProfessionalPdfBuffer(tickets)
      : await TicketService.generateMultipleTicketsPdfBuffer(tickets)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="comprobantes-seleccionados.pdf"`)
    res.send(pdfBuffer)
  } catch (error) {
    next(error)
  }
}

export const bulkDownloadTicketsZip = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { ids, format } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, message: 'Lista de IDs no proporcionada.' })
      return
    }

    const tickets = await TicketService.getTicketsByIds(ids)
    if (tickets.length === 0) {
      res.status(404).json({ success: false, message: 'No se encontraron tickets.' })
      return
    }

    const zipBuffer = await TicketService.generateTicketsZipBuffer(tickets, format === 'professional' ? 'professional' : 'ticket')

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="comprobantes-seleccionados.zip"`)
    res.send(zipBuffer)
  } catch (error) {
    next(error)
  }
}

export const previewGeneratedPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { format, ...data } = req.body
    const pdfBuffer = format === 'professional'
      ? await TicketService.generateProfessionalPdfBuffer(data)
      : await TicketService.generateTicketPdfBuffer(data)

    res.setHeader('Content-Type', 'application/pdf')
    res.send(pdfBuffer)
  } catch (error) {
    next(error)
  }
}

export const uploadTempAndExtract = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'Archivo no proporcionado' })
      return
    }

    const extractedData = await TicketService.parsePdfLocal(req.file.path)

    res.status(200).json({
      success: true,
      data: {
        filename: req.file.filename,
        originalFilename: req.file.originalname,
        url: `/uploads/temp/${req.file.filename}`,
        extracted: extractedData,
      },
    })
  } catch (error) {
    next(error)
  }
}

export const convertTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { filename, ...data } = req.body
    const result = await TicketService.convertToSaleNote(data, filename)

    res.status(201).json({
      success: true,
      data: result,
    })
  } catch (error) {
    next(error)
  }
}

export const updateTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    const result = await TicketService.updateTicket(id, req.body)

    if (!result) {
      res.status(404).json({ success: false, message: 'Comprobante no encontrado para actualizar' })
      return
    }

    res.status(200).json({
      success: true,
      data: result,
    })
  } catch (error) {
    next(error)
  }
}

export const deleteTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    await TicketService.deleteTicket(id)

    res.status(200).json({
      success: true,
      message: 'Ticket eliminado correctamente',
    })
  } catch (error) {
    next(error)
  }
}