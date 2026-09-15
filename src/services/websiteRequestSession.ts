import type { WebsitePublicationRequest } from './websitePublication';

/**
 * Demande de publication en cours, conservée dans l'onglet (sessionStorage) entre l'envoi de la
 * callable et sa réponse définitive (V4 point 2, lot B). Après un rechargement, le panneau la
 * retrouve et la rejoue à l'identique (même requestId, même révision attendue : l'idempotence
 * serveur interdit tout doublon) si le serveur est resté à cette révision ; sinon il l'oublie
 * sans bruit et l'état serveur fait foi. Module pur : aucun React, aucun Firebase ; un stockage
 * indisponible est silencieux (la demande ne vit alors qu'en mémoire).
 */
export type WebsiteRequestAction = 'publish' | 'revoke' | 'cleanup';

export interface WebsiteRequestSessionEntry {
  action: WebsiteRequestAction;
  signature: string;
  request: WebsitePublicationRequest;
  requestedAtIso: string;
}

const ACTIONS: readonly WebsiteRequestAction[] = ['publish', 'revoke', 'cleanup'];

export const websiteRequestSessionKey = (cartularyId: string) => `cartularia-website-request:${cartularyId}`;

const isSessionEntry = (value: unknown, cartularyId: string): value is WebsiteRequestSessionEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<WebsiteRequestSessionEntry>;
  const request = entry.request && typeof entry.request === 'object' ? entry.request as Partial<WebsitePublicationRequest> : null;
  return ACTIONS.includes(entry.action as WebsiteRequestAction)
    && typeof entry.signature === 'string'
    && typeof entry.requestedAtIso === 'string'
    && request !== null
    && request.cartularyId === cartularyId
    && typeof request.requestId === 'string'
    && Number.isInteger(request.expectedRevision);
};

export const readWebsiteRequestSession = (cartularyId: string): WebsiteRequestSessionEntry | null => {
  try {
    const raw = window.sessionStorage.getItem(websiteRequestSessionKey(cartularyId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSessionEntry(parsed, cartularyId) ? parsed : null;
  } catch {
    return null;
  }
};

export const writeWebsiteRequestSession = (cartularyId: string, entry: WebsiteRequestSessionEntry) => {
  try {
    window.sessionStorage.setItem(websiteRequestSessionKey(cartularyId), JSON.stringify(entry));
  } catch {
    // Stockage indisponible ou saturé : la demande reste en mémoire pour la durée de la page.
  }
};

export const clearWebsiteRequestSession = (cartularyId: string) => {
  try {
    window.sessionStorage.removeItem(websiteRequestSessionKey(cartularyId));
  } catch {
    // Stockage indisponible : rien à effacer.
  }
};
