/**
 * 'derivative-pending' : le média est vérifié mais sa copie de présentation (variantes v3) n'existe pas encore ;
 * l'interface affiche « Aperçu en préparation » et ne retombe JAMAIS sur l'original (décision V2 (d), objectif V3).
 * 'derivative-failed' : la copie de présentation ne sera PAS produite (échec sharp consigné dans le manifeste, ou original
 * rejeté par la vérification) ; l'interface le dit tel quel (« Copie de présentation non produite ») au lieu d'un
 * « en préparation » perpétuel ; l'original reste offert seulement par l'action explicite « Afficher l'original ».
 */
export type MediaFailureKind = 'session' | 'denied' | 'missing' | 'network' | 'integrity' | 'shared-unavailable' | 'too-large' | 'derivative-pending' | 'derivative-failed';

export class MediaFailure extends Error {
  readonly kind: MediaFailureKind;
  constructor(kind: MediaFailureKind) { super(mediaFailureMessage(kind)); this.name = 'MediaFailure'; this.kind = kind; }
}

export function mediaFailureKind(error: unknown): MediaFailureKind {
  if (error instanceof MediaFailure) return error.kind;
  const code = String((error as { code?: string })?.code || '');
  if (/unauthenticated|unauthenticated-user/.test(code)) return 'session';
  if (/unauthorized|permission-denied/.test(code)) return 'denied';
  if (/object-not-found|not-found/.test(code)) return 'missing';
  if (/invalid-checksum|integrity/.test(code)) return 'integrity';
  if (/max-size-exceeded/.test(code)) return 'too-large';
  return 'network';
}

export function mediaFailureMessage(kind: MediaFailureKind, language: 'FR' | 'EN' = 'FR') {
  const messages: Record<MediaFailureKind, [string, string]> = {
    session: ['Connectez-vous pour consulter ce média privé.', 'Sign in to view this private media.'],
    denied: ['L’accès à ce média n’est plus autorisé. Vérifiez votre session et vos droits.', 'Access to this media is no longer authorized. Check your session and access rights.'],
    missing: ['Ce fichier est absent ou a été retiré. Demandez sa vérification au propriétaire.', 'This file is missing or was withdrawn. Ask its owner to check it.'],
    network: ['Le chargement du média a été interrompu. Vérifiez votre connexion puis réessayez.', 'Media loading was interrupted. Check your connection and retry.'],
    integrity: ['Le contrôle du fichier a échoué. Cette copie ne peut pas être affichée.', 'File verification failed. This copy cannot be displayed.'],
    'shared-unavailable': ['Votre invitation permet de consulter le dossier, mais aucune copie média autorisée pour les invités n’est disponible dans ce parcours. Les originaux du propriétaire restent privés.', 'Your invitation allows viewing this record, but no media copy authorized for guests is available in this journey. Owner originals remain private.'],
    'too-large': ['Cette copie dépasse la limite de consultation de 100 Mio. Demandez au propriétaire une copie plus légère.', 'This copy exceeds the 100 MiB viewing limit. Ask the owner for a smaller copy.'],
    'derivative-pending': ['Aperçu en préparation', 'Preview in preparation'],
    'derivative-failed': ['Copie de présentation non produite', 'Presentation copy not produced'],
  };
  return messages[kind][language === 'FR' ? 0 : 1];
}
