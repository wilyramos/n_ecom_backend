// backend/src/modules/ticket/ticket.routes.ts
import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import {
  getTickets,
  getTicketById,
  downloadTicketPdf,
  bulkPrintTicketsPdf,
  bulkDownloadTicketsZip,
  previewGeneratedPdf,
  uploadTempAndExtract,
  convertTicket,
  deleteTicket,
} from './ticket.controller'
import { validateSchema } from '../../middleware/validate.middleware'
import { convertirTicketSchema } from './ticket.schema'

const router = Router()

const uploadDir = path.join(process.cwd(), 'uploads/temp')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
})
const upload = multer({ storage })

router.get('/', getTickets)
router.post('/bulk-print', bulkPrintTicketsPdf)
router.post('/bulk-zip', bulkDownloadTicketsZip)
router.get('/:id', getTicketById)
router.get('/:id/pdf', downloadTicketPdf)
router.post('/preview-pdf', previewGeneratedPdf)
router.post('/upload-extract', upload.single('ticket'), uploadTempAndExtract)
router.post('/convertir', validateSchema(convertirTicketSchema), convertTicket)
router.delete('/:id', deleteTicket)

export default router