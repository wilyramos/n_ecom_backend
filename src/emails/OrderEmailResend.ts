// File: backend/src/emails/OrderEmailResend.ts

import { resend } from "../config/resend";
import { baseEmailTemplate } from "./templates/baseEmailTemplate";
import { IPedido, EstadoPedido } from "../modules/pedidos/pedido.model";
import User, { IUser } from "../models/User";

const FROM_EMAIL = 'neoshop <no-reply@neoshopimportaciones.com>';

export interface IEmailItem {
  nombre: string;
  quantity: number;
  price: number;
  imagen?: string;
}

export interface IClientConfirmationParams {
  email: string;
  name?: string;
  orderId: string;
  totalPrice: number;
  shippingMethod: string;
  items?: IEmailItem[];
}

export interface IAdminNotificationParams {
  adminEmails: string[];
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerDocument?: string;
  orderId: string;
  totalPrice: number;
  shippingAddress: string;
  items?: IEmailItem[];
}

export class OrderEmail {
  // ==========================================
  // CONFIRMACIÓN PARA EL CLIENTE
  // ==========================================
  static async sendOrderConfirmationEmail({
    email,
    name,
    orderId,
    totalPrice,
    shippingMethod,
    items = [],
  }: IClientConfirmationParams) {
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
              <td style="text-align:center; padding:15px 10px; border-bottom:1px solid #f0f0f0; color: #71717a; font-size: 14px;">
                ${item.quantity}
              </td>
              <td style="text-align:right; padding:15px 10px; border-bottom:1px solid #f0f0f0; color: #71717a; font-size: 14px;">
                S/. ${item.price.toFixed(2)}
              </td>
              <td style="text-align:right; padding:15px 0; border-bottom:1px solid #f0f0f0; color: #0a0a0a; font-size: 14px;">
                <strong>S/. ${(item.price * item.quantity).toFixed(2)}</strong>
              </td>
            </tr>`
        )
        .join("");

      const emailContent = baseEmailTemplate({
        title: "¡Gracias por tu compra!",
        content: `
          <div style="color:#171411; line-height:1.6;">
            <p style="font-size:15px; color: #52525b;">Hola <strong style="color: #0a0a0a;">${name || "cliente"}</strong>,</p>
            <p style="font-size:15px;">
              Hemos recibido tu pedido <strong style="color: #0a0a0a;">#${orderId}</strong> con éxito y ya está confirmado en nuestro sistema.
            </p>

            <div style="margin-top:20px; padding: 15px; border: 1px solid #f0f0f0; border-radius: 8px; background-color: #fafafa;">
              <p style="margin:0; font-size:13.5px;">
                <strong style="color: #71717a; display:block; margin-bottom:2px;">Entrega:</strong> 
                <span style="color: #171411;">${shippingMethod}</span>
              </p>
            </div>

            <h3 style="margin-top:35px; margin-bottom: 15px; font-size:15px; font-weight:600; color: #0a0a0a; border-bottom: 2px solid #0a0a0a; padding-bottom: 8px; display: inline-block;">
              Resumen de tu pedido
            </h3>

            <table style="width:100%; border-collapse:collapse; font-size:13.5px;">
              <thead>
                <tr>
                  <th style="padding-bottom:10px; border-bottom:1px solid #e4e4e7; color:#71717a; text-align:left; font-weight:500;">Img</th>
                  <th style="padding-bottom:10px; border-bottom:1px solid #e4e4e7; color:#71717a; text-align:left; font-weight:500;">Producto</th>
                  <th style="padding-bottom:10px; border-bottom:1px solid #e4e4e7; color:#71717a; text-align:center; font-weight:500;">Cant.</th>
                  <th style="padding-bottom:10px; border-bottom:1px solid #e4e4e7; color:#71717a; text-align:right; font-weight:500;">Precio</th>
                  <th style="padding-bottom:10px; border-bottom:1px solid #e4e4e7; color:#71717a; text-align:right; font-weight:500;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div style="text-align:right; margin-top:20px;">
              <p style="font-size:17px; margin:0; color: #0a0a0a;">
                <span style="color: #71717a; font-size: 13.5px; font-weight: normal; margin-right: 8px;">Total:</span> 
                <strong>S/. ${totalPrice.toFixed(2)}</strong>
              </p>
            </div>

            <p style="margin-top:35px; font-size:13px; color:#71717a; text-align: center;">
              Puedes revisar el avance de tu entrega en cualquier momento desde nuestra sección de seguimiento.
            </p>
          </div>
        `,
      });

      await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: `Pedido Confirmado #${orderId} | NEOSHOP IMPORTACIONES`,
        html: emailContent,
      });

      return { success: true };
    } catch (error: unknown) {
      console.error(`❌ [OrderEmail] Error enviando confirmación cliente #${orderId}:`, error);
      return { success: false, error };
    }
  }

  // ==========================================
  // NOTIFICACIÓN PARA ADMINISTRADORES
  // ==========================================
  static async sendAdminOrderNotificationEmail({
    adminEmails,
    customerName,
    customerEmail,
    customerPhone,
    customerDocument, // 👈 NUEVO
    orderId,
    totalPrice,
    shippingAddress,
    items = [],
  }: IAdminNotificationParams) {
    if (!adminEmails || adminEmails.length === 0) return { success: false };

    try {
      const itemsHtml = items
        .map(
          (item) => `
            <tr>
              <td style="padding:10px 0; border-bottom:1px solid #f0f0f0; width: 50px;">
                <img 
                  src="${item.imagen || "https://neoshopimportaciones.com/logo.png"}" 
                  alt="${item.nombre}" 
                  style="width:42px; height:auto; border-radius:4px; border: 1px solid #f0f0f0; display:block;"
                />
              </td>
              <td style="padding:10px 8px; border-bottom:1px solid #f0f0f0; color: #171411; font-size: 13px;">
                <div style="font-weight:600;">${item.nombre}</div>
              </td>
              <td style="text-align:center; padding:10px 8px; border-bottom:1px solid #f0f0f0; color: #71717a; font-size: 13px;">${item.quantity}</td>
              <td style="text-align:right; padding:10px 8px; border-bottom:1px solid #f0f0f0; color: #71717a; font-size: 13px;">S/. ${item.price.toFixed(2)}</td>
              <td style="text-align:right; padding:10px 0; border-bottom:1px solid #f0f0f0; color: #0a0a0a; font-size: 13px;"><strong>S/. ${(item.price * item.quantity).toFixed(2)}</strong></td>
            </tr>`
        )
        .join("");

      const emailContent = baseEmailTemplate({
        title: "🚨 ¡Nuevo Pedido Confirmado!",
        content: `
          <div style="color:#171411; line-height:1.6;">
            <p style="font-size:15px; font-weight:600; color:#0a0a0a; text-align: center; margin-bottom: 25px;">
              Se ha confirmado una nueva orden en la tienda.
            </p>

            <div style="border: 1px solid #e4e4e7; padding:16px 20px; border-radius:8px; margin:20px 0; background-color:#fafafa;">
              <h4 style="margin:0 0 12px 0; font-size:11px; color:#71717a; text-transform: uppercase; letter-spacing: 0.8px;">Datos del Cliente & Despacho</h4>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color: #71717a; width: 90px; display: inline-block;">Cliente:</strong> <span style="color: #171411;">${customerName}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color: #71717a; width: 90px; display: inline-block;">Email:</strong> <span style="color: #171411;">${customerEmail}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color: #71717a; width: 90px; display: inline-block;">Teléfono:</strong> <span style="color: #171411;">${customerPhone || "No registrado"}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color: #71717a; width: 90px; display: inline-block;">Documento:</strong> <span style="color: #171411;">${customerDocument || "No especificado"}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color: #71717a; width: 90px; display: inline-block;">Entrega:</strong> <span style="color: #171411;">${shippingAddress}</span></p>
            </div>

            <h3 style="margin-top:25px; margin-bottom: 12px; font-size:14px; font-weight:600; color: #0a0a0a;">Artículos de la Orden #${orderId}</h3>

            <table style="width:100%; border-collapse:collapse; font-size:13px;">
              <thead>
                <tr>
                  <th style="padding-bottom:8px; border-bottom:1px solid #e4e4e7; color:#71717a; text-align:left; font-weight:500;">Img</th>
                  <th style="padding-bottom:8px; border-bottom:1px solid #e4e4e7; color:#71717a; text-align:left; font-weight:500;">Producto</th>
                  <th style="padding-bottom:8px; border-bottom:1px solid #e4e4e7; color:#71717a; text-align:center; font-weight:500;">Cant.</th>
                  <th style="padding-bottom:8px; border-bottom:1px solid #e4e4e7; color:#71717a; text-align:right; font-weight:500;">Precio</th>
                  <th style="padding-bottom:8px; border-bottom:1px solid #e4e4e7; color:#71717a; text-align:right; font-weight:500;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div style="text-align:right; margin-top:20px;">
              <p style="font-size:16px; margin:0; color: #0a0a0a;">
                <span style="color: #71717a; font-size: 13px; font-weight: normal; margin-right: 8px;">Total:</span> 
                <strong>S/. ${totalPrice.toFixed(2)}</strong>
              </p>
            </div>
          </div>
        `,
      });

      await resend.emails.send({
        from: FROM_EMAIL,
        to: adminEmails,
        subject: `[NUEVA ORDEN] #${orderId} - S/. ${totalPrice.toFixed(2)} (${customerName})`,
        html: emailContent,
      });

      return { success: true };
    } catch (error: unknown) {
      console.error(`❌ [OrderEmail] Error notificando admins sobre pedido #${orderId}:`, error);
      return { success: false, error };
    }
  }

  /**
   * Consulta los usuarios activos con rol 'administrador' y dispara la notificación.
   */
  static async notifyAdminsOnNewOrder(pedido: IPedido): Promise<void> {
    try {
      const adminUsers: Pick<IUser, 'email'>[] = await User.find(
        { rol: 'administrador', isActive: { $ne: false } },
        'email'
      ).lean();

      const adminEmails = adminUsers
        .map((u) => u.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e));

      if (adminEmails.length === 0) {
        console.warn(`⚠️ [OrderEmail] No se encontraron administradores con rol 'administrador' para notificar.`);
        return;
      }

      const fullAddress =
        pedido.deliveryMethod === 'pickup'
          ? 'Recojo en Tienda Oficial'
          : `${pedido.shippingAddress.direccion} (${pedido.shippingAddress.distrito}, ${pedido.shippingAddress.provincia} - ${pedido.shippingAddress.departamento})`;

      const fullName = `${pedido.customerProfile.nombre} ${pedido.customerProfile.apellidos || ""}`.trim();
      const documentDetail = `${pedido.customerProfile.tipoDocumento || 'DOC'}: ${pedido.customerProfile.numeroDocumento}`; // 👈 NUEVO

      await OrderEmail.sendAdminOrderNotificationEmail({
        adminEmails,
        customerName: fullName,
        customerEmail: pedido.customerProfile.email,
        customerPhone: pedido.customerProfile.telefono,
        customerDocument: documentDetail, // 👈 NUEVO
        orderId: pedido.orderNumber,
        totalPrice: pedido.totalPrice,
        shippingAddress: fullAddress,
        items: pedido.items.map((it) => ({
          nombre: it.nombre,
          quantity: it.quantity,
          price: it.price,
          imagen: it.imagen,
        })),
      });
    } catch (error: unknown) {
      console.error(`⚠️ [OrderEmail] Error consultando admins en BD para orden #${pedido.orderNumber}:`, error);
    }
  }

  // ==========================================
  // NOTIFICACIÓN DE CAMBIO DE ESTADO
  // ==========================================
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
          badgeColor: "#171411",
          label: "En Preparación",
        },
        [EstadoPedido.SHIPPED]: {
          subject: `Pedido #${orderId} ${deliveryMethod === 'pickup' ? 'listo para retiro' : 'en camino'} | NEOSHOP IMPORTACIONES`,
          title: deliveryMethod === 'pickup' ? "¡Tu pedido está listo para recoger!" : "¡Tu pedido va en camino!",
          message:
            deliveryMethod === 'pickup'
              ? "Tu pedido ya se encuentra disponible en tienda para que puedas acercarte a retirarlo."
              : "Tu paquete ha salido de nuestro almacén y se encuentra en ruta hacia la dirección registrada.",
          badgeColor: "#171411",
          label: deliveryMethod === 'pickup' ? "Listo para Retiro" : "Enviado",
        },
        [EstadoPedido.DELIVERED]: {
          subject: `Pedido #${orderId} entregado con éxito | NEOSHOP IMPORTACIONES`,
          title: "¡Pedido Entregado!",
          message: "Tu pedido ha sido completado y entregado con éxito. ¡Esperamos que disfrutes de tus productos!",
          badgeColor: "#0a0a0a",
          label: "Entregado",
        },
        [EstadoPedido.CANCELED]: {
          subject: `Pedido #${orderId} cancelado | NEOSHOP IMPORTACIONES`,
          title: "Pedido Cancelado",
          message: "Te informamos que tu pedido ha sido cancelado. Si tienes alguna duda sobre el motivo o reembolso, por favor contáctanos.",
          badgeColor: "#71717a",
          label: "Cancelado",
        },
        [EstadoPedido.PAID_BUT_OUT_OF_STOCK]: {
          subject: `Novedad sobre tu Pedido #${orderId} | NEOSHOP IMPORTACIONES`,
          title: "Incidencia con el inventario",
          message: "Tu pago fue procesado con éxito, pero uno o más artículos no cuentan con stock disponible en este momento. Nuestro equipo de soporte se pondrá en contacto contigo a la brevedad.",
          badgeColor: "#71717a",
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
            <p style="font-size:15px; color: #52525b;">Hola <strong style="color: #0a0a0a;">${name || "cliente"}</strong>,</p>
            <p style="font-size:15px;">
              Hay una actualización sobre tu pedido <strong style="color: #0a0a0a;">#${orderId}</strong>:
            </p>

            <div style="margin:25px 0; padding:18px; border: 1px solid #f0f0f0; border-radius:8px; border-left: 4px solid ${currentStatusInfo.badgeColor};">
              <span style="display:inline-block; padding:4px 10px; font-size:11px; font-weight:bold; letter-spacing: 0.5px; text-transform:uppercase; color:#ffffff; background-color:${currentStatusInfo.badgeColor}; border-radius:4px; margin-bottom:10px;">
                ${currentStatusInfo.label}
              </span>
              <p style="margin:0; font-size:14px; color:#171411;">
                ${currentStatusInfo.message}
              </p>
            </div>

            <p style="margin-top:25px; font-size:13.5px; color:#71717a;">
              Puedes consultar el avance de tu orden en cualquier momento ingresando con tu correo y ver en la seccion de mis pedidos.
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
    } catch (error: unknown) {
      console.error(`❌ [OrderEmail] Error enviando actualización de estado #${orderId}:`, error);
      return { success: false, error };
    }
  }
}