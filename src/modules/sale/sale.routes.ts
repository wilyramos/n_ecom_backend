import { Router } from 'express';
import {
    processSale,
    getSales,
    createQuote,
    convertQuote,
    getQuotes,
    downloadTicket,
    refundSale,
    exportSalesReport,
    getById,
    generateManualTicketPdf
} from './sale.controller';

const router = Router();

// --- OPERACIONES DE VENTA ---
router.post('/', processSale);           
router.get('/', getSales);               
router.get('/export', exportSalesReport); 
router.get('/:id/ticket', downloadTicket); 
router.get('/:id', getById);

// --- OPERACIONES DE PROFORMAS ---
router.post('/quote', createQuote);
router.get('/quotes', getQuotes);
router.post('/:id/convert', convertQuote);
router.post('/:id/refund', refundSale);

// --- NUEVO ENDPOINT EMISIÓN MANUAL SIN PERSISTENCIA ---
router.post('/manual-ticket', generateManualTicketPdf);

export default router;