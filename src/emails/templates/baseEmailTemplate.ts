type EmailTemplateParams = {
  title: string;
  content: string;
};

export function baseEmailTemplate({ title, content }: EmailTemplateParams): string {
  return `
  <!DOCTYPE html>
  <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #ffffff; color: #171411; margin:0; padding:20px;">
      <div style="max-width:600px; margin:0 auto; border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
        
        <!-- Header -->
        <div style="text-align:center; padding:32px 20px; background-color: #ffffff; border-bottom: 1px solid #f0f0f0;">
          <img src="https://www.neoshopimportaciones.com/logo-new.svg" alt="Neoshop Logo" style="max-width:140px; height:auto; display:block; margin:0 auto;" />
        </div>
        
        <!-- Body -->
        <div style="padding: 40px 32px; background-color: #ffffff;">
          <h1 style="font-size:22px; color: #0a0a0a; margin-top:0; margin-bottom: 24px; text-align: center; font-weight: 600;">
            ${title}
          </h1>
          <div style="font-size:15px; line-height:1.6; color: #171411;">
            ${content}
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #ffffff; padding: 24px 32px; text-align: center; border-top: 1px solid #f0f0f0;">
          <p style="margin: 0; font-size: 13px; color: #a0a0a0; line-height:1.5;">
            © ${new Date().getFullYear()} neoshopimportaciones.com<br/>
            Este mensaje fue enviado automáticamente. No respondas a este correo.
          </p>
        </div>
        
      </div>
    </body>
  </html>
  `;
}