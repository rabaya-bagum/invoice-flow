// Runs outside Jest (plain Node): reads a PDF from stdin, prints {"text","pages"} as JSON.
const { PDFParse } = require('pdf-parse');
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const parser = new PDFParse({ data: new Uint8Array(Buffer.concat(chunks)) });
  try {
    const r = await parser.getText();
    process.stdout.write(JSON.stringify({ text: r.text, pages: r.total }));
  } finally {
    await parser.destroy();
  }
});
