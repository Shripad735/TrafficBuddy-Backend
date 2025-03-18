const sharp = require('sharp');

/**
 * Compresses an image from base64 string
 * @param {string} base64Image - Base64-encoded image string with or without data URI scheme
 * @param {number} quality - JPEG quality (1-100), defaults to 50
 * @returns {Promise<string>} Compressed base64 image with data URI scheme
 */
async function compressImage(base64Image, quality = 50) {
  try {
    // Extract the content type and base64 data if in data URI format
    let contentType = 'image/jpeg'; // Default content type
    let base64Data = base64Image;
    
    const matches = base64Image.match(/^data:(.+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      contentType = matches[1];
      base64Data = matches[2];
    }
    
    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Compress image using sharp
    const compressedBuffer = await sharp(buffer)
      .jpeg({ quality: quality })
      .toBuffer();
    
    // Convert back to base64
    const compressedBase64 = compressedBuffer.toString('base64');
    
    // Return with proper data URI format
    return `data:image/jpeg;base64,${compressedBase64}`;
  } catch (error) {
    console.error('Error compressing image:', error);
    return base64Image; // Return original if compression fails
  }
}

module.exports = { compressImage };