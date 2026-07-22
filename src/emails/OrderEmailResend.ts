// File: backend/src/emails/OrderEmailResend.ts

import { resend } from "../config/resend";
import { baseEmailTemplate } from "./templates/baseEmailTemplate";
import type { IOrderItem } from "../models/Order";
import User from "../models/User";

export class OrderEmail {
  /**
   * Envía el correo de confirmación de pedido al cliente.
   */
  static async sendOrderConfirmationEmail({
    email,
    name,
    orderId,
    totalPrice,
    shippingMethod,
    items = [],
  }: {
    email: string;
    name?: string;
    orderId: string;
    totalPrice: number;
    shippingMethod: string;
    items?: IOrderItem[];
  }) {
    try {
      const itemsHtml = items
        .map(
          (item) => `
            <tr>
              <td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                <img 
                  src="${item.imagen || "https://neoshopimportaciones.com/logo.png"}"
                  alt="${item.nombre}"
                  style="width:55px; height:auto; border-radius:6px;"
                />
              </td>
              <td style="padding:10px; border-bottom:1px solid #f0f0f0;">
                <div style="font-weight:500;">${item.nombre}</div>
              </td>
              <td style="text-align:center; border-bottom:1px solid #f0f0f0;">
                ${item.quantity}
              </td>
              <td style="text-align:right; border-bottom:1px solid #f0f0f0;">
                S/. ${item.price.toFixed(2)}
              </td>
              <td style="text-align:right; border-bottom:1px solid #f0f0f0;">
                <strong>S/. ${(item.price * item.quantity).toFixed(2)}</strong>
              </td>
            </tr>`
        )
        .join("");

      const emailContent = baseEmailTemplate({
        title: "Gracias por tu compra",
        content: `
          <div style="font-family:Inter,Arial,sans-serif; color:#111827; line-height:1.6;">
            <p style="font-size:15px;">Hola ${name || "cliente"},</p>
            <p style="font-size:15px;">
              Hemos recibido tu pedido <strong>#${orderId}</strong> y ya está siendo procesado.
            </p>

            <p style="margin-top:8px; font-size:15px;">
              <strong>Direccion de envío:</strong> ${shippingMethod}
            </p>

            <h3 style="margin-top:20px; font-size:17px; font-weight:600;">Resumen de tu pedido</h3>

            <table style="width:100%; border-collapse:collapse; margin-top:10px; font-size:14px;">
              <thead>
                <tr style="color:#6b7280; text-align:left;">
                  <th style="padding-bottom:6px;">Imagen</th>
                  <th style="padding-bottom:6px;">Producto</th>
                  <th style="padding-bottom:6px;">Cant.</th>
                  <th style="padding-bottom:6px; text-align:right;">Precio</th>
                  <th style="padding-bottom:6px; text-align:right;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <p style="text-align:right; font-size:16px; margin-top:4px; font-weight:600;">
              Total pagado: S/. ${totalPrice.toFixed(2)}
            </p>

            <p style="margin-top:20px; font-size:14px; color:#4b5563;">
              Recibirás una notificación cuando tu pedido sea enviado.
            </p>

            <p style="margin-top:10px; font-size:14px;">
              Gracias por elegir <strong>neoshop</strong>
            </p>
          </div>
        `,
      });

      await resend.emails.send({
        from: "neoshop <contacto@neoshopimportaciones.com>",
        to: email,
        subject: "Tu pedido ha sido confirmado | NEOSHOP IMPORTACIONES",
        html: emailContent,
      });

      return {
        success: true,
        message: "Email de confirmación enviado correctamente",
      };
    } catch (error) {
      console.error("❌ Error al enviar el email de confirmación:", error);
      return {
        success: false,
        message: "Error al enviar el email de confirmación",
      };
    }
  }

  // ==========================================
  // NOTIFICACIÓN PARA ADMINISTRADORES
  // ==========================================

  /**
   * Envía la notificación de nuevo pedido pagado a una lista de correos de administradores.
   */
  static async sendAdminOrderNotificationEmail({
    adminEmails,
    customerName,
    customerEmail,
    customerPhone,
    orderId,
    totalPrice,
    shippingAddress,
    items = [],
  }: {
    adminEmails: string[];
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    orderId: string;
    totalPrice: number;
    shippingAddress: string;
    items?: IOrderItem[];
  }) {
    if (!adminEmails || adminEmails.length === 0) return;

    try {
      const itemsHtml = items
        .map(
          (item) => `
            <tr>
              <td style="padding:10px 0; border-bottom:1px solid #f0f0f0;">
                <img 
                  src="${item.imagen || "https://neoshopimportaciones.com/logo.png"}"
                  alt="${item.nombre}"
                  style="width:45px; height:auto; border-radius:6px;"
                />
              </td>
              <td style="padding:10px; border-bottom:1px solid #f0f0f0;">
                <div style="font-weight:500;">${item.nombre}</div>
              </td>
              <td style="text-align:center; border-bottom:1px solid #f0f0f0;">${item.quantity}</td>
              <td style="text-align:right; border-bottom:1px solid #f0f0f0;">S/. ${item.price.toFixed(2)}</td>
              <td style="text-align:right; border-bottom:1px solid #f0f0f0;"><strong>S/. ${(item.price * item.quantity).toFixed(2)}</strong></td>
            </tr>`
        )
        .join("");

      const emailContent = baseEmailTemplate({
        title: "🚨 ¡Nuevo Pedido Pagado Recibido!",
        content: `
          <div style="font-family:Inter,Arial,sans-serif; color:#111827; line-height:1.6;">
            <p style="font-size:15px; font-weight:bold; color:#16a34a;">
              Se ha confirmado el pago de un nuevo pedido.
            </p>

            <div style="background-color:#f9fafb; padding:12px; border-radius:8px; margin:15px 0;">
              <h4 style="margin:0 0 8px 0; font-size:14px; color:#374151;">Datos del Cliente:</h4>
              <p style="margin:2px 0; font-size:14px;"><strong>Nombre:</strong> ${customerName}</p>
              <p style="margin:2px 0; font-size:14px;"><strong>Email:</strong> ${customerEmail}</p>
              <p style="margin:2px 0; font-size:14px;"><strong>Teléfono:</strong> ${customerPhone || "No especificado"}</p>
              <p style="margin:2px 0; font-size:14px;"><strong>Dirección:</strong> ${shippingAddress}</p>
            </div>

            <h3 style="margin-top:20px; font-size:16px; font-weight:600;">Detalle de la Orden #${orderId}</h3>

            <table style="width:100%; border-collapse:collapse; margin-top:10px; font-size:14px;">
              <thead>
                <tr style="color:#6b7280; text-align:left;">
                  <th style="padding-bottom:6px;">Img</th>
                  <th style="padding-bottom:6px;">Producto</th>
                  <th style="padding-bottom:6px;">Cant.</th>
                  <th style="padding-bottom:6px; text-align:right;">Precio</th>
                  <th style="padding-bottom:6px; text-align:right;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <p style="text-align:right; font-size:16px; margin-top:10px; font-weight:bold;">
              Monto Total Cobrado: S/. ${totalPrice.toFixed(2)}
            </p>
          </div>
        `,
      });

      await resend.emails.send({
        from: "neoshop System <contacto@neoshopimportaciones.com>",
        to: adminEmails,
        subject: `[NUEVA VENTA] Pedido #${orderId} - S/. ${totalPrice.toFixed(2)}`,
        html: emailContent,
      });

      return { success: true };
    } catch (error) {
      console.error("❌ Error al enviar notificación por correo a administradores:", error);
      return { success: false };
    }
  }

  /**
   * Helper para consultar emails de admins activos y disparar la notificación.
   */
  static async notifyAdminsOnNewOrder(order: any) {
    try {
      const admins = await User.find({ rol: "administrador", isActive: true }, "email");
      const adminEmails = admins.map((admin) => admin.email);

      if (adminEmails.length === 0) return;

      const fullAddress = `${order.shippingAddress.direccion} (${order.shippingAddress.distrito}, ${order.shippingAddress.provincia})`;
      const fullName = `${order.customerProfile.nombre} ${order.customerProfile.apellidos || ""}`.trim();

      await OrderEmail.sendAdminOrderNotificationEmail({
        adminEmails,
        customerName: fullName,
        customerEmail: order.customerProfile.email,
        customerPhone: order.customerProfile.telefono,
        orderId: order.orderNumber,
        totalPrice: order.totalPrice,
        shippingAddress: fullAddress,
        items: order.items,
      });
    } catch (error) {
      console.error("⚠️ Error consultando admins para notificaciones de orden:", error);
    }
  }
}