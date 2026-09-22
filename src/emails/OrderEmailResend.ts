import { resend } from "../config/resend";
import { baseEmailTemplate } from "./templates/baseEmailTemplate";
import type { IOrderItem } from "../models/Order";
import User from "../models/User";
import { EstadoPedido } from "../modules/pedidos/pedido.model";

const FROM_EMAIL = 'neoshop <no-reply@neoshopimportaciones.com>';

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
              <td style="padding:15px 0; border-bottom:1px solid #f0f0f0; width: 65px;">
                <img 
                  src="${item.imagen || "https://neoshopimportaciones.com/logo.png"}"
                  alt="${item.nombre}"
                  style="width:55px; height:auto; border-radius:6px; border: 1px solid #f0f0f0; display: block;"
                />
              </td>
              <td style="padding:15px 10px; border-bottom:1px solid #f0f0f0; color: #171411;">
                <div style="font-weight:600; font-size: 14px;">${item.nombre}</div>
              </td>
              <td style="text-align:center; padding:15px 10px; border-bottom:1px solid #f0f0f0; color: #a0a0a0; font-size: 14px;">
                ${item.quantity}
              </td>
              <td style="text-align:right; padding:15px 10px; border-bottom:1px solid #f0f0f0; color: #a0a0a0; font-size: 14px;">
                S/. ${item.price.toFixed(2)}
              </td>
              <td style="text-align:right; padding:15px 0; border-bottom:1px solid #f0f0f0; color: #0a0a0a; font-size: 14px;">
                <strong>S/. ${(item.price * item.quantity).toFixed(2)}</strong>
              </td>
            </tr>`
        )
        .join("");

      const emailContent = baseEmailTemplate({
        title: "Gracias por tu compra",
        content: `
          <div style="color:#171411; line-height:1.6;">
            <p style="font-size:15px; color: #a0a0a0;">Hola <strong style="color: #0a0a0a;">${name || "cliente"}</strong>,</p>
            <p style="font-size:15px;">
              Hemos recibido tu pedido <strong style="color: #0a0a0a;">#${orderId}</strong> y ya está siendo procesado por nuestro equipo.
            </p>

            <div style="margin-top:20px; padding: 15px; border: 1px solid #f0f0f0; border-radius: 6px;">
              <p style="margin:0; font-size:14px;">
                <strong style="color: #a0a0a0; display:block; margin-bottom:4px;">Dirección de entrega:</strong> 
                <span style="color: #171411;">${shippingMethod}</span>
              </p>
            </div>

            <h3 style="margin-top:35px; margin-bottom: 15px; font-size:16px; font-weight:600; color: #0a0a0a; border-bottom: 2px solid #0a0a0a; padding-bottom: 8px; display: inline-block;">
              Resumen de tu pedido
            </h3>

            <table style="width:100%; border-collapse:collapse; font-size:14px;">
              <thead>
                <tr>
                  <th style="padding-bottom:10px; border-bottom:1px solid #a0a0a0; color:#a0a0a0; text-align:left; font-weight:500;">Imagen</th>
                  <th style="padding-bottom:10px; border-bottom:1px solid #a0a0a0; color:#a0a0a0; text-align:left; font-weight:500;">Producto</th>
                  <th style="padding-bottom:10px; border-bottom:1px solid #a0a0a0; color:#a0a0a0; text-align:center; font-weight:500;">Cant.</th>
                  <th style="padding-bottom:10px; border-bottom:1px solid #a0a0a0; color:#a0a0a0; text-align:right; font-weight:500;">Precio</th>
                  <th style="padding-bottom:10px; border-bottom:1px solid #a0a0a0; color:#a0a0a0; text-align:right; font-weight:500;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div style="text-align:right; margin-top:20px;">
              <p style="font-size:18px; margin:0; color: #0a0a0a;">
                <span style="color: #a0a0a0; font-size: 14px; font-weight: normal; margin-right: 10px;">Total pagado:</span> 
                <strong>S/. ${totalPrice.toFixed(2)}</strong>
              </p>
            </div>

            <p style="margin-top:40px; font-size:13px; color:#a0a0a0; text-align: center;">
              Recibirás una notificación por correo cada vez que el estado de tu pedido se actualice.
            </p>
          </div>
        `,
      });

      await resend.emails.send({
        from: FROM_EMAIL,
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
              <td style="padding:12px 0; border-bottom:1px solid #f0f0f0; width: 55px;">
                <img 
                  src="${item.imagen || "https://neoshopimportaciones.com/logo.png"}"
                  alt="${item.nombre}"
                  style="width:45px; height:auto; border-radius:4px; border: 1px solid #f0f0f0;"
                />
              </td>
              <td style="padding:12px 10px; border-bottom:1px solid #f0f0f0; color: #171411; font-size: 13px;">
                <div style="font-weight:600;">${item.nombre}</div>
              </td>
              <td style="text-align:center; padding:12px 10px; border-bottom:1px solid #f0f0f0; color: #a0a0a0; font-size: 13px;">${item.quantity}</td>
              <td style="text-align:right; padding:12px 10px; border-bottom:1px solid #f0f0f0; color: #a0a0a0; font-size: 13px;">S/. ${item.price.toFixed(2)}</td>
              <td style="text-align:right; padding:12px 0; border-bottom:1px solid #f0f0f0; color: #0a0a0a; font-size: 13px;"><strong>S/. ${(item.price * item.quantity).toFixed(2)}</strong></td>
            </tr>`
        )
        .join("");

      const emailContent = baseEmailTemplate({
        title: "🚨 Nuevo Pedido Registrado",
        content: `
          <div style="color:#171411; line-height:1.6;">
            <p style="font-size:15px; font-weight:600; color:#0a0a0a; text-align: center; margin-bottom: 30px;">
              Se ha confirmado el pago de un nuevo pedido en la tienda.
            </p>

            <div style="border: 1px solid #f0f0f0; padding:20px; border-radius:8px; margin:20px 0;">
              <h4 style="margin:0 0 15px 0; font-size:12px; color:#a0a0a0; text-transform: uppercase; letter-spacing: 1px;">Datos del Cliente</h4>
              <p style="margin:6px 0; font-size:14px;"><strong style="color: #a0a0a0; width: 80px; display: inline-block;">Nombre:</strong> <span style="color: #171411;">${customerName}</span></p>
              <p style="margin:6px 0; font-size:14px;"><strong style="color: #a0a0a0; width: 80px; display: inline-block;">Email:</strong> <span style="color: #171411;">${customerEmail}</span></p>
              <p style="margin:6px 0; font-size:14px;"><strong style="color: #a0a0a0; width: 80px; display: inline-block;">Teléfono:</strong> <span style="color: #171411;">${customerPhone || "No especificado"}</span></p>
              <p style="margin:6px 0; font-size:14px;"><strong style="color: #a0a0a0; width: 80px; display: inline-block;">Dirección:</strong> <span style="color: #171411;">${shippingAddress}</span></p>
            </div>

            <h3 style="margin-top:30px; margin-bottom: 15px; font-size:15px; font-weight:600; color: #0a0a0a;">Detalle de la Orden #${orderId}</h3>

            <table style="width:100%; border-collapse:collapse; font-size:13px;">
              <thead>
                <tr>
                  <th style="padding-bottom:8px; border-bottom:1px solid #a0a0a0; color:#a0a0a0; text-align:left; font-weight:500;">Img</th>
                  <th style="padding-bottom:8px; border-bottom:1px solid #a0a0a0; color:#a0a0a0; text-align:left; font-weight:500;">Producto</th>
                  <th style="padding-bottom:8px; border-bottom:1px solid #a0a0a0; color:#a0a0a0; text-align:center; font-weight:500;">Cant.</th>
                  <th style="padding-bottom:8px; border-bottom:1px solid #a0a0a0; color:#a0a0a0; text-align:right; font-weight:500;">Precio</th>
                  <th style="padding-bottom:8px; border-bottom:1px solid #a0a0a0; color:#a0a0a0; text-align:right; font-weight:500;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div style="text-align:right; margin-top:20px;">
              <p style="font-size:16px; margin:0; color: #0a0a0a;">
                <span style="color: #a0a0a0; font-size: 13px; font-weight: normal; margin-right: 10px;">Total Cobrado:</span> 
                <strong>S/. ${totalPrice.toFixed(2)}</strong>
              </p>
            </div>
          </div>
        `,
      });

      await resend.emails.send({
        from: FROM_EMAIL,
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
      // const admins = await User.find({ rol: "admin" }, "email");

      // solo mandar email a wilyramos21gmail.com
      const adminEmails = "wilyramos21@gmail.com";

      if (adminEmails.length === 0) return;

      const fullAddress = `${order.shippingAddress.direccion} (${order.shippingAddress.distrito}, ${order.shippingAddress.provincia})`;
      const fullName = `${order.customerProfile.nombre} ${order.customerProfile.apellidos || ""}`.trim();

      // await OrderEmail.sendAdminOrderNotificationEmail({
      //   adminEmails,
      //   customerName: fullName,
      //   customerEmail: order.customerProfile.email,
      //   customerPhone: order.customerProfile.telefono,
      //   orderId: order.orderNumber,
      //   totalPrice: order.totalPrice,
      //   shippingAddress: fullAddress,
      //   items: order.items,
      // });
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
          badgeColor: "#171411", // Adaptado al tema neutral
          label: "En Preparación",
        },
        [EstadoPedido.SHIPPED]: {
          subject: `Pedido #${orderId} ${deliveryMethod === 'pickup' ? 'listo para retiro' : 'en camino'} | NEOSHOP IMPORTACIONES`,
          title: deliveryMethod === 'pickup' ? "¡Tu pedido está listo para recoger!" : "¡Tu pedido va en camino!",
          message:
            deliveryMethod === 'pickup'
              ? "Tu pedido ya se encuentra disponible en tienda para que puedas acercarte a retirarlo."
              : "Tu paquete ha salido de nuestro almacén y se encuentra en ruta hacia la dirección registrada.",
          badgeColor: "#171411", // Adaptado al tema neutral
          label: deliveryMethod === 'pickup' ? "Listo para Retiro" : "Enviado",
        },
        [EstadoPedido.DELIVERED]: {
          subject: `Pedido #${orderId} entregado con éxito | NEOSHOP IMPORTACIONES`,
          title: "¡Pedido Entregado!",
          message: "Tu pedido ha sido completado y entregado con éxito. ¡Esperamos que disfrutes de tus productos!",
          badgeColor: "#0a0a0a", // Adaptado al tema neutral (más oscuro para éxito final)
          label: "Entregado",
        },
        [EstadoPedido.CANCELED]: {
          subject: `Pedido #${orderId} cancelado | NEOSHOP IMPORTACIONES`,
          title: "Pedido Cancelado",
          message: "Te informamos que tu pedido ha sido cancelado. Si tienes alguna duda sobre el motivo o reembolso, por favor contáctanos.",
          badgeColor: "#a0a0a0", // Adaptado al tema neutral
          label: "Cancelado",
        },
        [EstadoPedido.PAID_BUT_OUT_OF_STOCK]: {
          subject: `Novedad sobre tu Pedido #${orderId} | NEOSHOP IMPORTACIONES`,
          title: "Incidencia con el inventario",
          message: "Tu pago fue procesado con éxito, pero uno o más artículos no cuentan con stock disponible en este momento. Nuestro equipo de soporte se pondrá en contacto contigo a la brevedad.",
          badgeColor: "#a0a0a0", // Adaptado al tema neutral
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
          <div style="color:#171411; line-height:1.6;">
            <p style="font-size:15px; color: #a0a0a0;">Hola <strong style="color: #0a0a0a;">${name || "cliente"}</strong>,</p>
            <p style="font-size:15px;">
              Hay una actualización sobre tu pedido <strong style="color: #0a0a0a;">#${orderId}</strong>:
            </p>

            <div style="margin:30px 0; padding:20px; border: 1px solid #f0f0f0; border-radius:8px; border-left: 4px solid ${currentStatusInfo.badgeColor};">
              <span style="display:inline-block; padding:4px 10px; font-size:11px; font-weight:bold; letter-spacing: 0.5px; text-transform:uppercase; color:#ffffff; background-color:${currentStatusInfo.badgeColor}; border-radius:4px; margin-bottom:12px;">
                ${currentStatusInfo.label}
              </span>
              <p style="margin:0; font-size:14px; color:#171411;">
                ${currentStatusInfo.message}
              </p>
            </div>

            <p style="margin-top:30px; font-size:14px; color:#a0a0a0;">
              Puedes consultar el avance de tu orden en cualquier momento ingresando tu número de pedido y correo en nuestra sección de tracking.
            </p>
          </div>
        `,
      });

      await resend.emails.send({
        from: FROM_EMAIL,
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