/**
 * Persistência segura de perfis de conexão MT5 MCP nativo — WR Trading Pro
 *
 * Permite o usuário cadastrar múltiplas contas/corretoras MT5 (cada uma com
 * seu próprio endpoint/API key gerados em Tools > Options > MCP do terminal)
 * e trocar qual está ativa — em vez de um endpoint/chave fixos no `.env`.
 *
 * AES-256-GCM com nonce/tag por registro, reaproveitando a MESMA
 * `WR_LLM_CONFIG_ENCRYPTION_KEY` já usada pelos providers de LLM (ver
 * `getEncryptionKey` em `llm-secure-store.ts`) — evita exigir outra chave de
 * config. Sem a chave, falha fechado: nenhum perfil é lido/gravado/ativado.
 *
 * Nunca retorna a API key decifrada para fora deste módulo, exceto
 * `getActiveMt5ConnectionSecrets()` — usado só por `mt5-mcp-config.ts`
 * (server-side, nunca exposto por rota).
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { prisma } from '../prisma';
import { getEncryptionKey } from './llm-secure-store';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

export interface Mt5ConnectionProfileSummary {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
  readonly isActive: boolean;
  readonly updatedAt: string;
}

export interface Mt5ConnectionProfileInput {
  readonly name: string;
  readonly endpoint: string;
  readonly apiKey: string;
}

function encryptApiKey(key: Buffer, profileId: string, apiKey: string): { ciphertext: string; nonce: string; tag: string } {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(profileId, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(Buffer.from(apiKey, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: encrypted.toString('base64'), nonce: iv.toString('base64'), tag: tag.toString('base64') };
}

function decryptApiKey(
  key: Buffer,
  profileId: string,
  record: { apiKeyCiphertext: string; apiKeyNonce: string; apiKeyTag: string }
): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.apiKeyNonce, 'base64'));
    decipher.setAAD(Buffer.from(profileId, 'utf8'));
    decipher.setAuthTag(Buffer.from(record.apiKeyTag, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(record.apiKeyCiphertext, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

function toSummary(row: {
  id: string;
  name: string;
  endpoint: string;
  isActive: boolean;
  updatedAt: Date;
}): Mt5ConnectionProfileSummary {
  return { id: row.id, name: row.name, endpoint: row.endpoint, isActive: row.isActive, updatedAt: row.updatedAt.toISOString() };
}

export type Mt5ConnectionStoreResult<T> = { ok: true; data: T } | { ok: false; reason: 'no-encryption-key' };

/** Nunca inclui a API key — só o necessário para a UI listar/gerenciar perfis. */
export async function listMt5ConnectionProfiles(): Promise<Mt5ConnectionProfileSummary[]> {
  const rows = await prisma.mt5ConnectionProfile.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map(toSummary);
}

export async function createMt5ConnectionProfile(
  input: Mt5ConnectionProfileInput
): Promise<Mt5ConnectionStoreResult<Mt5ConnectionProfileSummary>> {
  const key = getEncryptionKey();
  if (!key) return { ok: false, reason: 'no-encryption-key' };

  const created = await prisma.mt5ConnectionProfile.create({
    data: { name: input.name, endpoint: input.endpoint, isActive: false, apiKeyCiphertext: '', apiKeyNonce: '', apiKeyTag: '' },
  });
  const { ciphertext, nonce, tag } = encryptApiKey(key, created.id, input.apiKey);
  const updated = await prisma.mt5ConnectionProfile.update({
    where: { id: created.id },
    data: { apiKeyCiphertext: ciphertext, apiKeyNonce: nonce, apiKeyTag: tag },
  });
  return { ok: true, data: toSummary(updated) };
}

export interface Mt5ConnectionProfileUpdate {
  readonly name?: string;
  readonly endpoint?: string;
  /** Omitido preserva a API key atual; string não-vazia substitui. */
  readonly apiKey?: string;
}

export async function updateMt5ConnectionProfile(
  id: string,
  patch: Mt5ConnectionProfileUpdate
): Promise<Mt5ConnectionStoreResult<Mt5ConnectionProfileSummary> | { ok: false; reason: 'not-found' }> {
  const existing = await prisma.mt5ConnectionProfile.findUnique({ where: { id } });
  if (!existing) return { ok: false, reason: 'not-found' };

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.endpoint !== undefined) data.endpoint = patch.endpoint;
  if (patch.apiKey !== undefined) {
    const key = getEncryptionKey();
    if (!key) return { ok: false, reason: 'no-encryption-key' };
    const { ciphertext, nonce, tag } = encryptApiKey(key, id, patch.apiKey);
    data.apiKeyCiphertext = ciphertext;
    data.apiKeyNonce = nonce;
    data.apiKeyTag = tag;
  }

  const updated = await prisma.mt5ConnectionProfile.update({ where: { id }, data });
  return { ok: true, data: toSummary(updated) };
}

export async function deleteMt5ConnectionProfile(id: string): Promise<void> {
  await prisma.mt5ConnectionProfile.deleteMany({ where: { id } });
}

/** Ativa `id` e desativa todos os outros — transacional, nunca deixa dois perfis ativos ao mesmo tempo. */
export async function setActiveMt5ConnectionProfile(id: string): Promise<{ ok: boolean }> {
  const existing = await prisma.mt5ConnectionProfile.findUnique({ where: { id } });
  if (!existing) return { ok: false };
  await prisma.$transaction([
    prisma.mt5ConnectionProfile.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    prisma.mt5ConnectionProfile.update({ where: { id }, data: { isActive: true } }),
  ]);
  return { ok: true };
}

/** Desativa todos os perfis — usado por "Desconectar"/voltar ao fallback do .env. */
export async function clearActiveMt5ConnectionProfile(): Promise<void> {
  await prisma.mt5ConnectionProfile.updateMany({ where: { isActive: true }, data: { isActive: false } });
}

/**
 * Endpoint + API key decifrados do perfil ATIVO, ou `null` se não houver
 * perfil ativo, a chave de criptografia estiver ausente, ou a decifragem
 * falhar (adulteração/rotação de chave) — em todos os casos o chamador
 * (`mt5-mcp-config.ts`) deve cair no fallback do `.env`.
 */
export async function getActiveMt5ConnectionSecrets(): Promise<{ endpoint: string; apiKey: string; profileId: string } | null> {
  const key = getEncryptionKey();
  if (!key) return null;

  const active = await prisma.mt5ConnectionProfile.findFirst({ where: { isActive: true } });
  if (!active) return null;

  const apiKey = decryptApiKey(key, active.id, active);
  if (!apiKey) return null;

  return { endpoint: active.endpoint, apiKey, profileId: active.id };
}
