import { resend } from "../config/resend";
import { baseEmailTemplate } from "./templates/baseEmailTemplate";

const FROM_EMAIL = 'neoshop <no-reply@neoshopimportaciones.com>';

export class AuthEmailResend {
    static async sendWelcomeEmail({ email, name }: { email: string; name: string }) {
        try {
            const emailContent = baseEmailTemplate({
                title: "¡Bienvenido a neoshop!",
                content: `
                    <p style="color: #a0a0a0;">Hola <strong style="color: #171411;">${name}</strong>,</p>
                    <p style="color: #171411;">Gracias por registrarte en neoshop. Estamos emocionados de tenerte con nosotros y que formes parte de nuestra comunidad.</p>
                    <p style="color: #a0a0a0;">Explora nuestro catálogo y descubre los mejores productos importados. Si tienes alguna pregunta, nuestro equipo de soporte está listo para ayudarte.</p>
                    
                    <div style="text-align: center; margin: 35px 0;">
                        <a href="${process.env.FRONTEND_URL}" style="background-color: #171411; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 15px;">Explorar Tienda</a>
                    </div>
                    
                    <p style="color: #a0a0a0;">Saludos,<br/><strong style="color: #171411;">El equipo de neoshop</strong></p>
                `
            });

            const response = await resend.emails.send({
                from: FROM_EMAIL,
                to: email,
                subject: 'Bienvenido a neoshop',
                html: emailContent
            });

            return { success: true, message: "Welcome email sent successfully" };
        } catch (error) {
            console.error('Error sending welcome email:', error);
            return { success: false, message: 'Error al enviar el correo' };
        }
    }

    static async sendEmailForgotPassword({ email, token }: { email: string; token: string }) {
        try {
            const resetLink = `${process.env.FRONTEND_URL}/auth/reset-password?token=${token}`;

            const emailContent = baseEmailTemplate({
                title: "Restablecer contraseña",
                content: `
                    <p style="color: #a0a0a0;">Hola,</p>
                    <p style="color: #171411;">Hemos recibido una solicitud para restablecer tu contraseña en tu cuenta de neoshop.</p>
                    
                    <div style="text-align: center; margin: 35px 0;">
                        <a href="${resetLink}" style="background-color: #171411; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 15px;">Restablecer mi contraseña</a>
                    </div>
                    
                    <div style="background-color: #ffffff; padding: 15px; border-radius: 6px; margin-bottom: 20px; border: 1px solid #a0a0a0;">
                        <p style="margin: 0; font-size: 13px; color: #171411;">
                            <strong style="color: #a0a0a0;">Nota:</strong> Este enlace expirará en 15 minutos. Si no realizaste esta solicitud, puedes ignorar este correo de forma segura.
                        </p>
                    </div>
                    
                    <p style="font-size: 13px; color: #a0a0a0; word-break: break-all;">
                        Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
                        <a href="${resetLink}" style="color: #a0a0a0; font-weight: bold;">${resetLink}</a>
                    </p>
                    
                    <p style="color: #a0a0a0;">Saludos,<br/><strong style="color: #171411;">El equipo de neoshop</strong></p>
                `
            });

            const response = await resend.emails.send({
                from: FROM_EMAIL,
                to: email,
                subject: 'Restablecimiento de contraseña | neoshop',
                html: emailContent
            });

            return { success: true, message: "Email de restablecimiento enviado" };
        } catch (error) {
            console.error('Error enviando email de restablecimiento:', error);
            return { success: false, message: 'Error al enviar el correo' };
        }
    }

    static async sendEmailPasswordUpdated({ email }: { email: string }) {
        try {
            const emailContent = baseEmailTemplate({
                title: "Contraseña actualizada",
                content: `
                    <p style="color: #a0a0a0;">Hola,</p>
                    <p style="color: #171411;">Te confirmamos que tu contraseña ha sido actualizada de manera exitosa.</p>
                    <p style="color: #a0a0a0;">Ya puedes iniciar sesión en tu cuenta utilizando tu nueva contraseña de acceso.</p>
                    
                    <div style="text-align: center; margin: 35px 0;">
                        <a href="${process.env.FRONTEND_URL}/auth/login" style="background-color: #171411; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 15px;">Iniciar sesión ahora</a>
                    </div>

                    <p style="font-size: 14px; color: #a0a0a0;">Si no realizaste esta acción, por favor contacta a soporte de inmediato.</p>
                    
                    <p style="color: #a0a0a0;">Saludos,<br/><strong style="color: #171411;">El equipo de neoshop</strong></p>
                `
            });

            const response = await resend.emails.send({
                from: FROM_EMAIL,
                to: email,
                subject: 'Contraseña actualizada | neoshop',
                html: emailContent
            });

            return { success: true, message: "Email de confirmación enviado" };
        } catch (error) {
            console.error('Error enviando email de confirmación:', error);
            return { success: false, message: 'Error al enviar el correo' };
        }
    }
}