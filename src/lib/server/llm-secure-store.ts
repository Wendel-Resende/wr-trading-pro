/**
 * Persistência segura da configuração de provedores LLM — WR Trading Pro
 *
 * Implementa a camada de criptografia autenticada exigida pela spec
 * (docs/architecture/2026-07-31-llm-providers-expansion.md,
 * "Configuração pela plataforma"): AES-256-GCM com nonce/tag por registro,
 * chave derivada de WR_LLM_CONFIG_ENCRYPTION_KEY (server-side, mínimo 32
 * caracteres). Sem a chave, todas as operações falham fechado — nenhum
 * segredo é lido, gravado, ou assumido como ausente por engano.
 *
 * Nunca persiste plaintext. Nunca retorna apiKey/ciphertext/nonce/tag a
 * chamadores fora deste módulo — os consumidores (llm-config.ts) só recebem
 * os campos decifrados para montar a credencial efetiva do provider.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';
import { prisma } from '../prisma';
import type { LlmUiConfigurableProvider } from '../../types/llm';

const ALGORITHM = 'aes-256-gcm';
const MIN_KEY_LENGTH = 32;
const IV_LENGTH_BYTES = 12;

export interface StoredProviderFields {
  apiKey?: string;
  model?: string;
  /** Somente relevante para LM_STUDIO; outros providers nunca gravam isto. */
  endpoint?: string;
}

/**
 * Deriva uma chave AES-256 (32 bytes) a partir de WR_LLM_CONFIG_ENCRYPTION_KEY.
 * Retorna null quando a env var está ausente ou curta demais — fail-closed.
 */
export function getEncryptionKey(): Buffer | null {
  const raw = process.env.WR_LLM_CONFIG_ENCRYPTION_KEY ?? '';
  if (raw.length < MIN_KEY_LENGTH) return null;
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function hasEncryptionKeyConfigured(): boolean {
  return getEncryptionKey() !== null;
}

function encryptFields(
  key: Buffer,
  provider: string,
  fields: StoredProviderFields
): { ciphertext: string; nonce: string; tag: string } {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  // AAD liga o ciphertext ao provider — um registro não pode ser "movido"
  // para outro provider mesmo com acesso de escrita direto ao banco.
  cipher.setAAD(Buffer.from(provider, 'utf8'));
  const plaintext = Buffer.from(JSON.stringify(fields), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    nonce: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decifra; retorna null (nunca lança) para chave errada, registro adulterado
 * ou JSON corrompido — trata como "sem configuração persistida" (fail-closed
 * em vez de derrubar o request).
 */
function decryptFields(
  key: Buffer,
  provider: string,
  record: { ciphertext: string; nonce: string; tag: string }
): StoredProviderFields | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.nonce, 'base64'));
    decipher.setAAD(Buffer.from(provider, 'utf8'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]);
    const parsed = JSON.parse(decrypted.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as StoredProviderFields;
  } catch {
    return null;
  }
}

export type SaveProviderConfigResult =
  | { ok: true }
  | { ok: false; reason: 'no-encryption-key' };

/**
 * Mescla `patch` sobre o registro existente (decifrado) e regrava cifrado.
 * Campos omitidos em `patch` preservam o valor persistido; string vazia
 * limpa o campo. Falha fechado sem a chave de criptografia.
 */
export async function saveProviderConfig(
  provider: LlmUiConfigurableProvider,
  patch: Partial<StoredProviderFields>
): Promise<SaveProviderConfigResult> {
  const key = getEncryptionKey();
  if (!key) return { ok: false, reason: 'no-encryption-key' };

  const existing = (await loadPersistedProviderConfig(provider)) ?? {};
  const merged: StoredProviderFields = {
    apiKey: patch.apiKey !== undefined ? patch.apiKey || undefined : existing.apiKey,
    model: patch.model !== undefined ? patch.model || undefined : existing.model,
    endpoint: patch.endpoint !== undefined ? patch.endpoint || undefined : existing.endpoint,
  };

  const { ciphertext, nonce, tag } = encryptFields(key, provider, merged);
  await prisma.llmProviderConfig.upsert({
    where: { provider },
    create: { provider, ciphertext, nonce, tag },
    update: { ciphertext, nonce, tag },
  });
  return { ok: true };
}

export async function clearProviderConfig(provider: LlmUiConfigurableProvider): Promise<void> {
  await prisma.llmProviderConfig.deleteMany({ where: { provider } });
}

/**
 * Campos decifrados do provider, ou null quando não há registro, a chave de
 * criptografia está ausente, ou a decifragem falha (adulteração/rotação de
 * chave) — em todos os casos o chamador deve tratar como "sem configuração
 * persistida" e cair no fallback do .env.
 */
export async function loadPersistedProviderConfig(
  provider: LlmUiConfigurableProvider
): Promise<StoredProviderFields | null> {
  const key = getEncryptionKey();
  if (!key) return null;

  const record = await prisma.llmProviderConfig.findUnique({ where: { provider } });
  if (!record) return null;

  return decryptFields(key, provider, record);
}

export async function listPersistedProviders(): Promise<LlmUiConfigurableProvider[]> {
  const key = getEncryptionKey();
  if (!key) return [];
  const rows = await prisma.llmProviderConfig.findMany({ select: { provider: true } });
  return rows.map((r: { provider: string }) => r.provider as LlmUiConfigurableProvider);
}
