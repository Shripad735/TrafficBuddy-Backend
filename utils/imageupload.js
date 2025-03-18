const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');
const path = require('path');
const { compressImage } = require('./imageCompression'); // Add this import

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY,
  },
});

const uploadImageToR2 = async (base64Image, folder = 'traffic_buddy') => {
  try {
    if (!base64Image) {
      throw new Error('Missing required parameter: base64Image');
    }

    console.log(`Starting R2 upload to folder: ${folder}`);
    
    // Compress the image before uploading (50% quality)
    console.log('Compressing image...');
    const compressedImage = await compressImage(base64Image, 50);
    console.log('Image compressed successfully');
    
    // Default folder to traffic_buddy if not specified
    const uploadFolder = folder || 'traffic_buddy';
    
    // Extract the content type and base64 data
    const matches = compressedImage.match(/^data:(.+);base64,(.+)$/);
    
    if (!matches || matches.length !== 3) {
      console.log('Invalid base64 format, trying alternative parsing...');
      // Try alternative approach for malformed base64
      const buffer = Buffer.from(compressedImage, 'base64');
      const fileName = `${uploadFolder}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpeg`;
      
      const command = new PutObjectCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: fileName,
        Body: buffer,
        ContentType: 'image/jpeg',
      });
      
      await s3Client.send(command);
      const url = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${fileName}`;
      console.log('Upload successful with alternative method:', url);
      return url;
    }

    const contentType = matches[1];
    const base64Data = matches[2];
    
    console.log(`Content type: ${contentType}`);
    console.log(`Base64 data length: ${base64Data.length} characters`);
    
    const buffer = Buffer.from(base64Data, 'base64');
    console.log(`Buffer size: ${buffer.length} bytes`);
    
    const fileName = `${uploadFolder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${contentType.split('/')[1] || 'jpeg'}`;
    console.log(`File name: ${fileName}`);

    const command = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: fileName,
      Body: buffer,
      ContentType: contentType,
    });

    console.log('Sending to R2...');
    await s3Client.send(command);
    console.log('Upload complete');
    
    // Construct the public URL using the public endpoint
    const url = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${fileName}`;
    console.log('Generated URL:', url);
    return url;
  } catch (error) {
    console.error('Error uploading image to R2:', error);
    throw new Error(`Failed to upload image: ${error.message}`);
  }
};

module.exports = { uploadImageToR2 };