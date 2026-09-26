// Documentos da família: tipos, validade e quando avisar para renovar.

import type { IconName } from './categories';
import { diffDays, formatBRDate } from './dates';

export type DocumentKind =
  | 'rg'
  | 'cpf'
  | 'cnh'
  | 'passaporte'
  | 'titulo_eleitor'
  | 'certidao'
  | 'carteira_trabalho'
  | 'plano_saude'
  | 'veiculo'
  | 'imovel'
  | 'contrato'
  | 'seguro'
  | 'imposto'
  | 'outro';

export interface DocumentKindInfo {
  key: DocumentKind;
  label: string;
  icon: IconName;
  /** Documento de uma pessoa (RG, CNH) ou da casa (seguro, contrato). */
  personal: boolean;
  /** Antecedência padrão do aviso: passaporte demora a sair, boleto não. */
  remindDays: number;
}

export const DOCUMENT_KINDS: DocumentKindInfo[] = [
  { key: 'rg', label: 'RG', icon: 'card-account-details-outline', personal: true, remindDays: 60 },
  { key: 'cnh', label: 'CNH', icon: 'card-account-details-star-outline', personal: true, remindDays: 45 },
  { key: 'passaporte', label: 'Passaporte', icon: 'passport', personal: true, remindDays: 180 },
  { key: 'cpf', label: 'CPF', icon: 'card-account-details-outline', personal: true, remindDays: 30 },
  { key: 'titulo_eleitor', label: 'Título de eleitor', icon: 'vote-outline', personal: true, remindDays: 30 },
  { key: 'certidao', label: 'Certidão', icon: 'file-certificate-outline', personal: true, remindDays: 30 },
  { key: 'carteira_trabalho', label: 'Carteira de trabalho', icon: 'briefcase-outline', personal: true, remindDays: 30 },
  { key: 'plano_saude', label: 'Carteirinha do plano', icon: 'card-plus-outline', personal: true, remindDays: 30 },
  { key: 'veiculo', label: 'Veículo (CRLV)', icon: 'car-info', personal: false, remindDays: 30 },
  { key: 'imovel', label: 'Imóvel', icon: 'home-city-outline', personal: false, remindDays: 30 },
  { key: 'contrato', label: 'Contrato', icon: 'file-sign', personal: false, remindDays: 60 },
  { key: 'seguro', label: 'Seguro', icon: 'shield-check-outline', personal: false, remindDays: 30 },
  { key: 'imposto', label: 'Imposto (IPTU, IPVA)', icon: 'bank-outline', personal: false, remindDays: 15 },
  { key: 'outro', label: 'Outro', icon: 'file-document-outline', personal: false, remindDays: 30 },
];

export function getDocumentKind(key: string): DocumentKindInfo {
  return DOCUMENT_KINDS.find((k) => k.key === key) ?? DOCUMENT_KINDS[DOCUMENT_KINDS.length - 1];
}

export const REMIND_OPTIONS = [15, 30, 60, 90, 180];

export type DocumentStatus =
  | { kind: 'vencido'; days: number }
  | { kind: 'renovar'; days: number }
  | { kind: 'valido'; days: number }
  | { kind: 'sem_validade' };

/** "Renovar" = dentro da antecedência escolhida para o documento. */
export function documentStatus(expiresOn: string | null, remindDays: number, today: string): DocumentStatus {
  if (!expiresOn) return { kind: 'sem_validade' };
  const days = diffDays(today, expiresOn);
  if (days < 0) return { kind: 'vencido', days: -days };
  if (days <= remindDays) return { kind: 'renovar', days };
  return { kind: 'valido', days };
}

export function describeDocumentStatus(status: DocumentStatus, expiresOn: string | null): string {
  switch (status.kind) {
    case 'vencido':
      return status.days === 0 ? 'Venceu hoje' : status.days === 1 ? 'Venceu ontem' : `Venceu há ${status.days} dias`;
    case 'renovar':
      return status.days === 0 ? 'Vence hoje' : status.days === 1 ? 'Vence amanhã' : `Vence em ${status.days} dias`;
    case 'valido':
      return `Válido até ${formatBRDate(expiresOn!)}`;
    case 'sem_validade':
      return 'Sem validade';
  }
}

export interface DocumentLike {
  expires_on: string | null;
  remind_days: number;
}

/** Vencidos e a renovar, do mais urgente para o menos. */
export function documentsNeedingAttention<T extends DocumentLike>(
  documents: T[],
  today: string,
): { document: T; status: DocumentStatus }[] {
  return documents
    .map((document) => ({ document, status: documentStatus(document.expires_on, document.remind_days, today) }))
    .filter(({ status }) => status.kind === 'vencido' || status.kind === 'renovar')
    .sort((a, b) => a.document.expires_on!.localeCompare(b.document.expires_on!));
}
