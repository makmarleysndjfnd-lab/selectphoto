import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// Configuração do cliente S3 para o Backblaze B2
const s3 = new S3Client({
  endpoint: process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com',
  region: 'us-east-005', // A região é extraída do endpoint (ex: us-east-005)
  credentials: {
    accessKeyId: process.env.B2_KEY_ID || '',
    secretAccessKey: process.env.B2_APPLICATION_KEY || '',
  },
});

export const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
    acl: 'public-read', // Permite que a foto seja lida publicamente pelo app
    metadata: function (req: any, file: any, cb: any) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req: any, file: any, cb: any) {
      const ext = path.extname(file.originalname) || '.jpg';
      const fileName = `${uuidv4()}${ext}`;
      cb(null, fileName);
    },
  }),
});
