/**
 * Identifiant local unique et lisible (`<préfixe>-<horodatage>-<aléa hexadécimal>`).
 * Déplacé à l'identique depuis `App.tsx` (V5 P-D3) pour être partagé par le pipeline d'import des médias.
 * Aucune garantie cryptographique : sert à distinguer des enregistrements d'un même navigateur, jamais à prouver.
 */
export const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
