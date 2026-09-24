const crypto = require('crypto');

function getKey() {
  const source = process.env.CRM_CREDENTIAL_ENCRYPTION_KEY || process.env.META_APP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!source) throw new Error('Credential encryption key not configured');
  return crypto.createHash('sha256').update(source).digest();
}

function encryptCredential(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptCredential(payload) {
  const [version, ivB64, tagB64, dataB64] = String(payload || '').split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted credential');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encryptCredential, decryptCredential };
