import { RequestHandler } from 'express';
import { SaleService } from './sale.service';
import { generateSaleTicket } from '../../utils/ticketGenerator';
import { Sale } from '../../models/Sale';
import PDFDocument from 'pdfkit';

const saleService = new SaleService();

/**
 * PROCESAR VENTA REAL
 */
export const processSale: RequestHandler = async (req, res) => {
    try {
        const sale = await saleService.createSale(req.body);
        res.status(201).json({
            success: true,
            message: 'Venta procesada con éxito',
            receiptNumber: sale.receiptNumber,
            sale
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Error al procesar la venta';
        res.status(400).json({ success: false, message });
    }
};

/**
 * CREAR PROFORMA / PRESUPUESTO
 */
export const createQuote: RequestHandler = async (req, res) => {
    try {
        const quote = await saleService.createQuote(req.body);
        res.status(201).json({
            success: true,
            message: 'Proforma guardada con éxito',
            quote
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Error al crear proforma';
        res.status(400).json({ success: false, message });
    }
};

export const getSales: RequestHandler = async (req, res) => {
    try {
        const filters = {
            page: parseInt(req.query.page as string) || 1,
            limit: parseInt(req.query.limit as string) || 10,
            search: req.query.search as string,
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
            status: req.query.status as string,
            cashShiftId: req.query.cashShiftId as string,
        };

        const result = await saleService.getSaleHistory(filters);

        res.status(200).json({
            success: true,
            ...result
        });
    } catch (error: unknown) {
        res.status(500).json({ success: false, message: 'Error al obtener historial' });
    }
};

/**
 * CONVERTIR PROFORMA A VENTA REAL
 */
export const convertQuote: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const { employeeId, paymentMethod } = req.body;

        if (!employeeId) {
            res.status(400).json({ success: false, message: 'ID de empleado requerido' });
            return;
        }

        const sale = await saleService.convertQuoteToSale(id, employeeId, paymentMethod);
        res.status(200).json({
            success: true,
            message: 'Proforma convertida en venta con éxito',
            receiptNumber: sale.receiptNumber,
            sale
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Error al convertir proforma';
        res.status(400).json({ success: false, message });
    }
};

/**
 * OBTENER LISTADO DE VENTAS Y PROFORMAS
 */
export const exportSalesReport: RequestHandler = async (req, res) => {
    try {
        // Reutilizamos la lógica de filtros pero sin paginación
        const salesData = await saleService.getSaleHistory({
            ...req.query,
            limit: 5000, // Límite razonable para un reporte
            page: 1
        });

        const sales = salesData.sales;

        // Cabeceras del CSV
        let csv = 'Fecha,Comprobante,Cliente,Documento,Metodo,Total,Estado\n';

        sales.forEach((s: any) => {
            const fecha = s.createdAt.toISOString().split('T')[0];
            const cliente = s.customerSnapshot?.nombre || 'Cliente Varios';
            const doc = s.customerSnapshot?.numeroDocumento || '-';
            csv += `${fecha},${s.receiptNumber},${cliente},${doc},${s.paymentMethod},${s.totalPrice},${s.status}\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=reporte-ventas.csv');
        res.status(200).send(csv);
    } catch (error) {
        res.status(500).json({ message: 'Error al exportar reporte' });
    }
};

export const getQuotes: RequestHandler = async (req, res) => {
    try {
        const quotes = await saleService.getQuotes();
        res.status(200).json({ success: true, quotes });
    } catch (error: unknown) {
        res.status(500).json({ success: false, message: 'Error al obtener proformas' });
    }
};

/**
 * GENERAR Y DESCARGAR TICKET PDF
 */
export const downloadTicket: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const sale = await Sale.findById(id)
            .populate('items.product', 'nombre precio')
            .populate('employee', 'nombre');

        if (!sale) {
            res.status(404).json({ message: 'Venta no encontrada' });
            return;
        }

        const pdfBuffer = await generateSaleTicket(sale);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ticket-${sale.receiptNumber || 'quote'}.pdf`);
        res.send(pdfBuffer);
    } catch (error: unknown) {
        console.error("PDF Error:", error);
        res.status(500).json({ message: 'Error al generar el PDF del ticket' });
    }
};

// backend/src/modules/sale/sale.controller.ts

export const refundSale: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const refundedSale = await saleService.refundSale(id, reason || 'Anulación de venta');

        res.status(200).json({
            success: true,
            message: 'Venta anulada y stock restablecido',
            sale: refundedSale
        });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const getById: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const sale = await saleService.getSaleById(id);
        if (!sale) {
            res.status(404).json({ success: false, message: 'Venta no encontrada' });
            return;
        }
        res.status(200).json({ success: true, sale });
    }
    catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
    }
};


export const generateManualTicketPdf: RequestHandler = async (req, res, next) => {
    try {
        const {
            ticketSize = '80mm',
            storeName,
            address,
            email,
            phone,
            website,
            date,
            productName,
            partNumber,
            serialNumber,
            imei1,
            imei2,
            returnDate,
            subTotal,
            tax,
            total,
            paymentMethod,
            cardNumber,
            transactionId,
            barcodeValue
        } = req.body;

        // Validación de parámetros críticos
        if (!ticketSize || !storeName || !productName || !transactionId) {
            res.status(400).json({
                success: false,
                message: 'Faltan parámetros estructurales críticos'
            });
            return;
        }

        // ==================== CONFIGURACIÓN DE TAMAÑO ====================
        const widthMm = ticketSize === '80mm' ? 80 : 58;
        const pageWidth = widthMm * 2.83464; // Conversión mm a puntos PostScript
        const pageHeight = ticketSize === '80mm' ? 680 : 620;
        const margin = 12;
        const contentWidth = pageWidth - (margin * 2);

        // ==================== INICIALIZACIÓN PDF ====================
        const doc = new PDFDocument({
            size: [pageWidth, pageHeight],
            margins: { top: margin, bottom: margin, left: margin, right: margin }
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ticket-${transactionId}.pdf`);
        doc.pipe(res);

        // ==================== ESTILOS Y CONSTANTES ====================
        const styles = {
            fontSmall: 6.5,
            fontBase: 7.5,
            fontMedium: 8,
            fontLarge: 9,
            fontTitle: 11,
            lineSpacing: 1,
            smallSpacing: 0.2,
            normalSpacing: 0.4,
            largeSpacing: 0.6,
            lineWidth: 0.5,
            dividerMargin: margin
        };

        // ==================== HELPER FUNCTIONS ====================
        const drawDivider = (spacing = styles.normalSpacing) => {
            doc.lineWidth(styles.lineWidth)
                .moveTo(styles.dividerMargin, doc.y)
                .lineTo(pageWidth - styles.dividerMargin, doc.y)
                .stroke();
            doc.moveDown(spacing);
        };

        const textWithLineGap = (text: string, fontSize: number, options: any = {}) => {
            doc.font('Courier').fontSize(fontSize)
                .text(text, { lineGap: styles.lineSpacing, ...options });
        };

        // ==================== SECCIÓN 1: ENCABEZADO DE TIENDA ====================
        doc.font('Courier-Bold').fontSize(styles.fontTitle)
            .text(storeName.toUpperCase(), { align: 'left' });
        doc.moveDown(styles.smallSpacing);

        textWithLineGap(address, styles.fontBase, { lineGap: 1.2 });
        textWithLineGap(email, styles.fontBase);
        textWithLineGap(phone, styles.fontBase);
        textWithLineGap(website, styles.fontBase);
        doc.moveDown(styles.normalSpacing);

        drawDivider(styles.smallSpacing);

        // ==================== SECCIÓN 2: FECHA Y HORA ====================
        textWithLineGap(date, styles.fontBase);
        doc.moveDown(styles.normalSpacing);

        drawDivider(styles.largeSpacing);

        // ==================== SECCIÓN 3: INFORMACIÓN DEL PRODUCTO ====================
        doc.font('Courier-Bold').fontSize(styles.fontMedium)
            .text(productName.toUpperCase(), { lineGap: 1.5 });
        doc.moveDown(styles.smallSpacing);

        doc.font('Courier').fontSize(styles.fontBase);
        textWithLineGap(`Part Number: ${partNumber}`, styles.fontBase, { lineGap: 1 });
        textWithLineGap(`Serial Number: ${serialNumber}`, styles.fontBase, { lineGap: 1 });
        textWithLineGap(`IMEI 1: ${imei1}`, styles.fontBase, { lineGap: 1 });
        textWithLineGap(`IMEI 2: ${imei2}`, styles.fontBase, { lineGap: 1 });
        textWithLineGap(`Return Date: ${returnDate}`, styles.fontBase);
        doc.moveDown(styles.largeSpacing);

        // ==================== SECCIÓN 4: INFORMACIÓN DE SOPORTE ====================
        textWithLineGap('For Support, Visit:', styles.fontBase, { lineGap: 1 });
        textWithLineGap(`${website}/support`, styles.fontBase, { lineGap: 1 });
        textWithLineGap('Device Unlocked', styles.fontBase);
        doc.moveDown(styles.largeSpacing);

        drawDivider(styles.normalSpacing);

        // ==================== SECCIÓN 5: TÉRMINOS Y CONDICIONES ====================
        doc.font('Courier').fontSize(styles.fontSmall);

        const terms = [
            `Use of device constitutes acceptance of the ${storeName} terms and conditions found in the product box, or at http://${website}/legal/sla/. This model is configured to work natively across standard carrier networks.`,
            'The sales tax varies by state and may be based on the unbundled purchase rather than the actual purchase price.',
            `If you are not fully satisfied with your purchase, you can return your undamaged product within 14 days of purchase for a full refund with no restocking fee.`,
            `If you disagree with these terms and conditions you can return the product in accordance with the ${storeName} Store's return policy.`,
            `For information on ${storeName}'s privacy policy see www.${website}/privacy.`
        ];

        terms.forEach((term, index) => {
            doc.text(term, {
                align: 'justify',
                lineGap: 1.5,
                width: contentWidth
            });
            if (index < terms.length - 1) {
                doc.moveDown(styles.smallSpacing);
            }
        });

        doc.moveDown(styles.largeSpacing);
        drawDivider(styles.normalSpacing);

        // ==================== SECCIÓN 6: TABLA DE PRECIOS ====================
        const priceStartY = doc.y;
        const labelColumn = margin + (contentWidth * 0.45);
        const valueColumn = pageWidth - margin;

        doc.font('Courier').fontSize(styles.fontBase);

        // Sub Total
        doc.text('Sub Total', margin, priceStartY);
        doc.text(`$${Number(subTotal).toFixed(2)}`, labelColumn, priceStartY, {
            width: valueColumn - labelColumn,
            align: 'right'
        });

        // GST/HST
        const gstY = priceStartY + 12;
        doc.text('GST/HST', margin, gstY);
        doc.text(`$${Number(tax).toFixed(2)}`, labelColumn, gstY, {
            width: valueColumn - labelColumn,
            align: 'right'
        });

        // Total
        const totalY = gstY + 12;
        doc.font('Courier-Bold').fontSize(styles.fontBase);
        doc.text('Total', margin, totalY);
        doc.text(`$${Number(total).toFixed(2)}`, labelColumn, totalY, {
            width: valueColumn - labelColumn,
            align: 'right'
        });

        doc.y = totalY + 16;
        doc.moveDown(styles.largeSpacing);

        // ==================== SECCIÓN 7: INFORMACIÓN DE PAGO ====================
        doc.font('Courier').fontSize(styles.fontBase);

        const paymentY = doc.y;
        textWithLineGap('Payment Method', styles.fontBase);
        textWithLineGap(paymentMethod, styles.fontBase);
        textWithLineGap(cardNumber, styles.fontBase);
        textWithLineGap(transactionId, styles.fontBase);
        doc.moveDown(styles.largeSpacing);

        // ==================== SECCIÓN 8: NOTA SOBRE TARJETA DE REGALO ====================
        doc.font('Courier').fontSize(styles.fontSmall);
        doc.text(
            `Gift card remaining balance may exclude any pending orders placed through the ${storeName} Online Store or phone sales.`,
            {
                align: 'justify',
                lineGap: 1.5,
                width: contentWidth
            }
        );
        doc.moveDown(styles.normalSpacing);

        drawDivider(styles.largeSpacing);

        // ==================== SECCIÓN 9: CÓDIGO DE BARRAS ====================
        const barcodeStartY = doc.y;
        const barHeight = 24;
        const barSpacing = 0.6;

        // Generar patrón de barras (simulación de código de barras)
        const barPattern = [1.5, 1, 2.5, 0.8, 1, 2, 2.5, 1, 1.5, 0.8, 1, 2.5, 1.5, 1, 1.5, 0.8, 1, 2, 2.5, 1, 1.5, 0.8, 1, 2.5, 1, 1.5, 0.8, 2.5, 1, 1, 2, 2.5];

        // Centrar código de barras
        const totalBarWidth = barPattern.reduce((sum, w) => sum + w, 0) + (barPattern.length - 1) * barSpacing;
        let barStartX = (pageWidth - totalBarWidth) / 2;

        doc.lineWidth(1);
        barPattern.forEach((width, index) => {
            if (index % 2 === 0) { // Barras negras (pares)
                doc.rect(barStartX, barcodeStartY, width, barHeight).fill();
            }
            barStartX += width + barSpacing;
        });

        // Número de barras
        doc.y = barcodeStartY + barHeight + 2;
        doc.font('Courier').fontSize(styles.fontMedium);
        doc.text(barcodeValue, {
            align: 'center',
            characterSpacing: 2,
            width: contentWidth
        });

        doc.end();

    } catch (error) {
        next(error);
    }
};