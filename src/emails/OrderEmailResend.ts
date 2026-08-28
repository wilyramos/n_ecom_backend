import { resend } from "../config/resend";
import { baseEmailTemplate } from "./templates/baseEmailTemplate";
import type { IOrderItem } from "../models/Order";
import User from "../models/User";
import { EstadoPedido } from "../modules/pedidos/pedido.model";

export class OrderEmail {
  /**
   * Envía el correo de confirmación de pedido pagado al cliente.
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
              <strong>Dirección de entrega:</strong> ${shippingMethod}
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
              Recibirás una notificación por correo cada vez que el estado de tu pedido se actualice.
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

  // ==========================================
  // NOTIFICACIÓN DE CAMBIO DE ESTADO (CLIENTE)
  // ==========================================

  /**
   * Notifica al cliente cuando el estado de su orden cambia.
   * Excluye expresamente 'awaiting_payment'.
   */
  static async sendStatusUpdateEmail({
    email,
    name,
    orderId,
    newStatus,
    deliveryMethod,
  }: {
    email: string;
    name?: string;
    orderId: string;
    newStatus: EstadoPedido;
    deliveryMethod: 'shipping' | 'pickup';
  }) {
    // Nunca enviar correo de actualización si la orden está en espera de pago
    if (newStatus === EstadoPedido.AWAITING_PAYMENT) {
      return { success: false, message: "No se envían correos en awaiting_payment" };
    }

    try {
      const statusDetails: Partial<
        Record<
          EstadoPedido,
          { subject: string; title: string; message: string; badgeColor: string; label: string }
        >
      > = {
        [EstadoPedido.PROCESSING]: {
          subject: `Pedido #${orderId} en preparación | NEOSHOP IMPORTACIONES`,
          title: "¡Tu pedido está en preparación!",
          message: "Hemos recibido tu pago y nuestro equipo está alistando tus productos para el despacho.",
          badgeColor: "#3b82f6",
          label: "En Preparación",
        },
        [EstadoPedido.SHIPPED]: {
          subject: `Pedido #${orderId} ${deliveryMethod === 'pickup' ? 'listo para retiro' : 'en camino'} | NEOSHOP IMPORTACIONES`,
          title: deliveryMethod === 'pickup' ? "¡Tu pedido está listo para recoger!" : "¡Tu pedido va en camino!",
          message:
            deliveryMethod === 'pickup'
              ? "Tu pedido ya se encuentra disponible en tienda para que puedas acercarte a retirarlo."
              : "Tu paquete ha salido de nuestro almacén y se encuentra en ruta hacia la dirección registrada.",
          badgeColor: "#6366f1",
          label: deliveryMethod === 'pickup' ? "Listo para Retiro" : "Enviado",
        },
        [EstadoPedido.DELIVERED]: {
          subject: `Pedido #${orderId} entregado con éxito | NEOSHOP IMPORTACIONES`,
          title: "¡Pedido Entregado!",
          message: "Tu pedido ha sido completado y entregado con éxito. ¡Esperamos que disfrutes de tus productos!",
          badgeColor: "#16a34a",
          label: "Entregado",
        },
        [EstadoPedido.CANCELED]: {
          subject: `Pedido #${orderId} cancelado | NEOSHOP IMPORTACIONES`,
          title: "Pedido Cancelado",
          message: "Te informamos que tu pedido ha sido cancelado. Si tienes alguna duda sobre el motivo o reembolso, por favor contáctanos.",
          badgeColor: "#ef4444",
          label: "Cancelado",
        },
        [EstadoPedido.PAID_BUT_OUT_OF_STOCK]: {
          subject: `Novedad sobre tu Pedido #${orderId} | NEOSHOP IMPORTACIONES`,
          title: "Incidencia con el inventario",
          message: "Tu pago fue procesado con éxito, pero uno o más artículos no cuentan con stock disponible en este momento. Nuestro equipo de soporte se pondrá en contacto contigo a la brevedad.",
          badgeColor: "#f97316",
          label: "Sin Stock Temporal",
        },
      };

      const currentStatusInfo = statusDetails[newStatus];
      if (!currentStatusInfo) {
        return { success: false, message: "Estado sin plantilla configurada" };
      }

      const emailContent = baseEmailTemplate({
        title: currentStatusInfo.title,
        content: `
          <div style="font-family:Inter,Arial,sans-serif; color:#111827; line-height:1.6;">
            <p style="font-size:15px;">Hola ${name || "cliente"},</p>
            <p style="font-size:15px;">
              Hay una actualización sobre tu pedido <strong>#${orderId}</strong>:
            </p>

            <div style="margin:20px 0; padding:16px; background-color:#f9fafb; border-radius:8px; border-left:4px solid ${currentStatusInfo.badgeColor};">
              <span style="display:inline-block; padding:4px 10px; font-size:12px; font-weight:700; text-transform:uppercase; color:#fff; background-color:${currentStatusInfo.badgeColor}; border-radius:4px; margin-bottom:8px;">
                ${currentStatusInfo.label}
              </span>
              <p style="margin:8px 0 0 0; font-size:14px; color:#374151;">
                ${currentStatusInfo.message}
              </p>
            </div>

            <p style="margin-top:20px; font-size:14px; color:#4b5563;">
              Puedes consultar el avance de tu orden ingresando tu número de pedido y correo en nuestra sección de tracking.
            </p>

            <p style="margin-top:16px; font-size:14px;">
              Gracias por confiar en <strong>neoshop</strong>.
            </p>
          </div>
        `,
      });

      await resend.emails.send({
        from: "neoshop <contacto@neoshopimportaciones.com>",
        to: email,
        subject: currentStatusInfo.subject,
        html: emailContent,
      });

      return { success: true };
    } catch (error) {
      console.error(`❌ [OrderEmail] Error enviando actualización de estado #${orderId}:`, error);
      return { success: false, error };
    }
  }
}