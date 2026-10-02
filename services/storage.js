const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// PDFs stay "raw" with a .pdf name so browsers open them in place.
async function uploadDocument(buffer, { fileName, mimeType }) {
  const isPdf = mimeType === 'application/pdf';
  const result = await cloudinary.uploader.upload(`data:${mimeType};base64,${buffer.toString('base64')}`, {
    folder: 'aivorah/school-resources',
    resource_type: isPdf ? 'raw' : 'image',
    ...(isPdf ? { public_id: `doc_${Date.now()}.pdf` } : {}),
    filename_override: fileName,
  });
  return result.secure_url;
}

module.exports = { uploadDocument };
