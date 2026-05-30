import PDFKit from "pdfkit";
import { IOrder } from "../models/Order";
import { IUser } from "../models/User";

const COMPANY = {
    nombre: "NeoShop Importaciones.",
    ruc: "1078632515",
    direccion: "Av caminos del inca 257-Surco Piso 3 - Tda 326",
    city: "Lima - Perú",
    telefono: "925054636",
    email: "ventas@neoshopimportaciones.com",
};

const COLORS = {
    primary: "#111827",
    secondary: "#4B5563",
    muted: "#9CA3AF",
    border: "#E5E7EB",
    surface: "#F3F4F6", // Ligeramente más oscuro para contraste
};

const formatCurrency = (value: number, currency: string = "PEN") => 
    `${currency === "PEN" ? "S/" : "$"} ${value.toFixed(2)}`;

const formatDate = (date?: Date | string) => 
    new Date(date || Date.now()).toLocaleDateString('es-PE', { year: 'numeric', month: 'short', day: 'numeric' });

export const buildOrderReceipt = (doc: PDFKit.PDFDocument, order: IOrder, logoPath?: string) => {
    let currentY = 50;

    // Header
    if (logoPath) {
        try { doc.image(logoPath, 50, currentY, { width: 80 }); } catch (e) { }
    }

    doc.font("Helvetica-Bold").fontSize(18).fillColor(COLORS.primary).text(COMPANY.nombre.toUpperCase(), 140, currentY);
    doc.font("Helvetica").fontSize(8).fillColor(COLORS.secondary)
        .text(`RUC: ${COMPANY.ruc}`, 140, currentY + 22)
        .text(COMPANY.direccion, 140, currentY + 34)
        .text(COMPANY.email, 140, currentY + 46);

    doc.font("Helvetica-Bold").fontSize(16).fillColor(COLORS.primary).text("ORDEN", 400, currentY, { align: "right" });
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.secondary)
        .text(`N° ${order.orderNumber}`, 400, currentY + 20, { align: "right" })
        .text(formatDate(order.createdAt), 400, currentY + 35, { align: "right" });

    currentY += 80;
    doc.strokeColor(COLORS.border).lineWidth(0.5).moveTo(50, currentY).lineTo(550, currentY).stroke();
    currentY += 20;

    // Info Cliente
    const user = order.user as unknown as IUser;
    doc.fontSize(8).fillColor(COLORS.muted).text("PARA:", 50, currentY);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.primary).text(user?.nombre || "Cliente", 50, currentY + 12);
    
    doc.fontSize(8).fillColor(COLORS.muted).text("ENVÍO:", 320, currentY);
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.secondary)
        .text(order.shippingAddress.direccion, 320, currentY + 12, { width: 200 })
        .text(`${order.shippingAddress.distrito}, ${order.shippingAddress.departamento}`, 320, currentY + 24);

    currentY += 60;

    // Tabla
    doc.rect(50, currentY, 500, 20).fill(COLORS.surface);
    doc.fillColor(COLORS.secondary).font("Helvetica-Bold").fontSize(8);
    doc.text("PRODUCTO", 60, currentY + 7);
    doc.text("CANT", 350, currentY + 7, { width: 40, align: "center" });
    doc.text("PRECIO", 400, currentY + 7, { width: 60, align: "right" });
    doc.text("TOTAL", 480, currentY + 7, { width: 60, align: "right" });

    currentY += 30;
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.primary);

    order.items.forEach((item) => {
        doc.text(item.nombre, 60, currentY, { width: 280 });
        doc.text(item.quantity.toString(), 350, currentY, { width: 40, align: "center" });
        doc.text(formatCurrency(item.price, order.currency), 400, currentY, { width: 60, align: "right" });
        doc.text(formatCurrency(item.price * item.quantity, order.currency), 480, currentY, { width: 60, align: "right" });
        currentY += 25;
    });

    // Totales
    currentY += 10;
    doc.strokeColor(COLORS.border).lineWidth(0.5).moveTo(350, currentY).lineTo(550, currentY).stroke();
    currentY += 15;

    const drawRow = (label: string, value: string, bold = false) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10)
            .text(label, 350, currentY, { width: 100, align: "right" })
            .text(value, 460, currentY, { width: 80, align: "right" });
        currentY += 20;
    };

    drawRow("Subtotal:", formatCurrency(order.subtotal, order.currency));
    drawRow("Envío:", formatCurrency(order.shippingCost, order.currency));
    currentY += 5;
    drawRow("TOTAL:", formatCurrency(order.totalPrice, order.currency), true);

    // Footer
    doc.fontSize(8).fillColor(COLORS.muted).text("Documento informativo. No válido para efectos tributarios.", 50, 750, { align: "center", width: 500 });
};