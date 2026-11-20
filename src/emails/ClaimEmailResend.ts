// File: backend/src/emails/ClaimEmailResend.ts

import { resend } from "../config/resend";
import { baseEmailTemplate } from "./templates/baseEmailTemplate";
import User, { IUser } from "../models/User";
import type { IClaim, ClaimStatus } from "../modules/claim/claim.model";

const FROM_EMAIL = 'neoshop <no-reply@neoshopimportaciones.com>';

// Escapa el contenido ingresado por el consumidor antes de insertarlo en el HTML del correo
const escapeHtml = (value: string | undefined | null): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDate = (date?: Date | string | null): string =>
  date ? new Date(date).toLocaleDateString("es-PE", { dateStyle: "medium" }) : "No especificada";

const STATUS_STYLES: Record<ClaimStatus, { label: string; color: string; message: string }> = {
  Pendiente: {
    label: "Pendiente",
    color: "#b45309",
    message: "Su caso fue registrado y se encuentra pendiente de atención.",
  },
  "En Proceso": {
    label: "En Proceso",
    color: "#1d4ed8",
    message: "Su caso se encuentra en evaluación por nuestro equipo.",
  },
  Resuelto: {
    label: "Resuelto",
    color: "#047857",
    message: "Su caso ha sido atendido y cerrado.",
  },
};

export class ClaimEmail {
  /**
   * Obtiene los correos de los usuarios activos con rol 'administrador'.
   */
  static async getAdminEmails(): Promise<string[]> {
    const adminUsers: Pick<IUser, "email">[] = await User.find(
      { rol: "administrador", isActive: { $ne: false } },
      "email"
    ).lean();

    return adminUsers
      .map((u) => u.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e));
  }

  /**
   * Notifica a los administradores que se registró un nuevo reclamo/queja en el libro de reclamaciones.
   */
  static async notifyAdminsOnNewClaim(
    claim: IClaim,
    recordatorio?: { diasSinAtender: number }
  ): Promise<{ success: boolean; error?: unknown }> {
    try {
      const adminEmails = await this.getAdminEmails();

      if (adminEmails.length === 0) {
        console.warn(`⚠️ [ClaimEmail] No se encontraron administradores para notificar el reclamo ${claim.correlativo}.`);
        return { success: false };
      }

      const { consumer, detail } = claim;
      const esRecordatorio = Boolean(recordatorio);

      const titulo = esRecordatorio
        ? `⏰ ${escapeHtml(detail.tipoReclamo)} pendiente de atención`
        : `🚨 Nuevo ${escapeHtml(detail.tipoReclamo)} registrado`;

      const introduccion = esRecordatorio
        ? `El ${escapeHtml(detail.tipoReclamo)} <strong>${escapeHtml(claim.correlativo)}</strong> lleva <strong>${recordatorio!.diasSinAtender} días</strong> sin resolverse o sin una respuesta institucional registrada.`
        : `Se ha registrado un nuevo ${escapeHtml(detail.tipoReclamo)} en el Libro de Reclamaciones.`;

      const emailContent = baseEmailTemplate({
        title: titulo,
        content: `
          <div style="color:#171411; line-height:1.6;">
            <p style="font-size:15px; font-weight:600; color:#0a0a0a; text-align:center; margin-bottom:25px;">
              ${introduccion}
            </p>

            <div style="border:1px solid #e4e4e7; padding:16px 20px; border-radius:8px; margin:20px 0; background-color:#fafafa;">
              <h4 style="margin:0 0 12px 0; font-size:11px; color:#71717a; text-transform:uppercase; letter-spacing:0.8px;">Datos del Registro</h4>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color:#71717a; width:130px; display:inline-block;">Correlativo:</strong> <span style="color:#171411;">${escapeHtml(claim.correlativo)}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color:#71717a; width:130px; display:inline-block;">Tipo:</strong> <span style="color:#171411;">${escapeHtml(detail.tipoReclamo)}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color:#71717a; width:130px; display:inline-block;">Fecha del hecho:</strong> <span style="color:#171411;">${formatDate(detail.fechaIncidencia)}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color:#71717a; width:130px; display:inline-block;">Pedido:</strong> <span style="color:#171411;">${escapeHtml(detail.pedido)}</span></p>
            </div>

            <div style="border:1px solid #e4e4e7; padding:16px 20px; border-radius:8px; margin:20px 0; background-color:#fafafa;">
              <h4 style="margin:0 0 12px 0; font-size:11px; color:#71717a; text-transform:uppercase; letter-spacing:0.8px;">Datos del Consumidor</h4>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color:#71717a; width:130px; display:inline-block;">Nombre:</strong> <span style="color:#171411;">${escapeHtml(consumer.nombres)}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color:#71717a; width:130px; display:inline-block;">Documento:</strong> <span style="color:#171411;">${escapeHtml(consumer.tipoDocumento)}: ${escapeHtml(consumer.numeroDocumento)}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color:#71717a; width:130px; display:inline-block;">Correo:</strong> <span style="color:#171411;">${escapeHtml(consumer.email)}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color:#71717a; width:130px; display:inline-block;">Celular:</strong> <span style="color:#171411;">${escapeHtml(consumer.celular)}</span></p>
              <p style="margin:4px 0; font-size:13.5px;"><strong style="color:#71717a; width:130px; display:inline-block;">Dirección:</strong> <span style="color:#171411;">${escapeHtml(consumer.direccion)}, ${escapeHtml(consumer.ciudad)} (${escapeHtml(consumer.region)})</span></p>
            </div>

            <h3 style="margin-top:25px; margin-bottom:12px; font-size:14px; font-weight:600; color:#0a0a0a;">Detalle del ${escapeHtml(detail.tipoReclamo)}</h3>
            <div style="padding:14px; border:1px solid #f0f0f0; border-radius:8px; font-size:14px; color:#171411; white-space:pre-wrap;">${escapeHtml(detail.detalle)}</div>

            <p style="margin-top:25px; font-size:13.5px; color:#71717a;">
              Ingrese al panel de administración para revisar el caso y registrar la respuesta institucional.
            </p>
          </div>
        `,
      });

      await resend.emails.send({
        from: FROM_EMAIL,
        to: adminEmails,
        subject: esRecordatorio
          ? `[RECORDATORIO ${detail.tipoReclamo.toUpperCase()}] ${claim.correlativo} sin atender | NEOSHOP IMPORTACIONES`
          : `[NUEVO ${detail.tipoReclamo.toUpperCase()}] ${claim.correlativo} | NEOSHOP IMPORTACIONES`,
        html: emailContent,
      });

      return { success: true };
    } catch (error: unknown) {
      console.error(`❌ [ClaimEmail] Error notificando a administradores el reclamo ${claim.correlativo}:`, error);
      return { success: false, error };
    }
  }

  /**
   * Envía al consumidor la respuesta institucional y el estado actual de su reclamo.
   */
  static async sendResponseToConsumer(claim: IClaim): Promise<{ success: boolean; error?: unknown }> {
    try {
      const { consumer, detail, resolution } = claim;
      const status = STATUS_STYLES[resolution.estado] ?? STATUS_STYLES.Pendiente;

      const emailContent = baseEmailTemplate({
        title: "Respuesta a su " + escapeHtml(detail.tipoReclamo),
        content: `
          <div style="color:#171411; line-height:1.6;">
            <p style="font-size:15px; color:#52525b;">Hola <strong style="color:#0a0a0a;">${escapeHtml(consumer.nombres)}</strong>,</p>
            <p style="font-size:15px;">
              Le informamos que su ${escapeHtml(detail.tipoReclamo)} con código <strong style="color:#0a0a0a;">${escapeHtml(claim.correlativo)}</strong> ha sido actualizado.
            </p>

            <div style="margin:25px 0; padding:18px; border:1px solid #f0f0f0; border-radius:8px; border-left:4px solid ${status.color};">
              <p style="margin:0 0 6px 0; font-size:12px; color:#71717a; text-transform:uppercase; letter-spacing:0.5px;">Estado actual</p>
              <span style="display:inline-block; padding:4px 10px; font-size:11px; font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; color:#ffffff; background-color:${status.color}; border-radius:4px; margin-bottom:10px;">
                ${status.label}
              </span>
              <p style="margin:0; font-size:14px; color:#171411;">${status.message}</p>
            </div>

            <h3 style="margin-top:25px; margin-bottom:12px; font-size:14px; font-weight:600; color:#0a0a0a;">Respuesta de la empresa</h3>
            <div style="padding:16px; border:1px solid #e4e4e7; border-radius:8px; background-color:#fafafa; font-size:14px; color:#171411; white-space:pre-wrap;">${escapeHtml(resolution.respuestaProveedor) || "Sin respuesta registrada."}</div>

            <p style="margin-top:20px; font-size:13px; color:#71717a;">
              Fecha de respuesta: ${formatDate(resolution.fechaRespuesta)}<br/>
              Fecha de registro: ${formatDate(claim.createdAt)}
            </p>

            <p style="margin-top:25px; font-size:13px; color:#71717a;">
              Puede consultar el estado de su reclamo en cualquier momento con su código de correlativo y su número de documento.
            </p>
          </div>
        `,
      });

      await resend.emails.send({
        from: FROM_EMAIL,
        to: consumer.email,
        subject: `Respuesta a su ${detail.tipoReclamo} ${claim.correlativo} (${status.label}) | NEOSHOP IMPORTACIONES`,
        html: emailContent,
      });

      return { success: true };
    } catch (error: unknown) {
      console.error(`❌ [ClaimEmail] Error enviando respuesta del reclamo ${claim.correlativo} al consumidor:`, error);
      return { success: false, error };
    }
  }
}
