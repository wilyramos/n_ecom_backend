import PDFDocument from "pdfkit";

// Cambiamos la referencia al namespace global por el tipo exportado por PDFKit
type PDFDocumentType = PDFKit.PDFDocument;
type PDFDocumentOptions = PDFKit.PDFDocumentOptions;

type BuildContentFn<T> = (doc: PDFDocumentType, data: T) => void;

export class PdfService {
    /**
     * @param buildContent Función que inyecta el diseño
     * @param data Datos dinámicos
     * @param options Opciones de PDFKit
     */
    static async generateBuffer<T>(
        buildContent: BuildContentFn<T>, 
        data: T,
        options: PDFDocumentOptions = { margin: 50, size: "A4" }
    ): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument(options);
                const chunks: Buffer[] = [];

                doc.on("data", (chunk: Buffer) => chunks.push(chunk));
                doc.on("end", () => resolve(Buffer.concat(chunks)));
                doc.on("error", (err: Error) => reject(err));

                buildContent(doc, data);
                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }
}