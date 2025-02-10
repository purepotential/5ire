import fs from 'fs';
import * as logging from './logging';
import officeParser from 'officeparser';

abstract class BaseLoader {
  protected abstract read(filePath: string): Promise<string>;

  async load(filePath: string): Promise<string> {
    return await this.read(filePath);
  }
}

class TextDocumentLoader extends BaseLoader {
  async read(filePath: fs.PathLike): Promise<string> {
    return await fs.promises.readFile(filePath, 'utf-8');
  }
}

class OfficeLoader extends BaseLoader {
  constructor() {
    super();
  }

  async read(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      officeParser.parseOffice(filePath, function (text: string, error: any) {
        if (error) {
          reject(error);
        } else {
          resolve(text);
        }
      });
    });
  }
}

class PdfLoader extends BaseLoader {
  async read(filePath: fs.PathLike): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const PDFParser = (await import('pdf2json')).default;
        const pdfParser = new PDFParser();

        pdfParser.on('pdfParser_dataError', (errData: any) => {
          logging.error('Error reading PDF:', errData.parserError);
          reject(errData.parserError);
        });

        pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
          try {
            const pages = pdfData.Pages || [];
            const text = pages
              .map((page: any) => {
                const texts = page.Texts || [];
                return texts
                  .map((text: any) => 
                    text.R
                      .map((r: any) => decodeURIComponent(r.T))
                      .join(' ')
                  )
                  .join(' ');
              })
              .join('\n\n');

            resolve(text || 'No text content found in PDF');
          } catch (error) {
            logging.error('Error processing PDF data:', error);
            reject(error);
          }
        });

        pdfParser.loadPDF(filePath.toString());
      } catch (error) {
        logging.error('Error initializing PDF parser:', error);
        reject(error);
      }
    });
  }
}

export async function loadDocument(
  filePath: string,
  fileType: string
): Promise<string> {
  logging.info(`load file from  ${filePath} on ${process.platform}`);
  let Loader: new () => BaseLoader;
  switch (fileType) {
    case 'txt':
      Loader = TextDocumentLoader;
      break;
    case 'md':
      Loader = TextDocumentLoader;
      break;
    case 'csv':
      Loader = TextDocumentLoader;
      break;
    case 'pdf':
      Loader = PdfLoader;
      break;
    case 'docx':
      Loader = OfficeLoader;
      break;
    case 'pptx':
      Loader = OfficeLoader;
      break;
    case 'xlsx':
      Loader = OfficeLoader;
      break;
    default:
      throw new Error(`Miss Loader for: ${fileType}`);
  }
  const loader = new Loader();
  let result = await loader.load(filePath);
  result = result.replace(/ +/g, ' ');
  const paragraphs = result
    .split(/\r?\n\r?\n/)
    .map((i) => i.replace(/\s+/g, ' '))
    .filter((i) => i.trim() !== '');
  return paragraphs.join('\r\n\r\n');
}
