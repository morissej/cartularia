import { Eye, ShieldCheck } from 'lucide-react';
import type { AuthoritativeCartularyStatus } from '../state/useAuthoritativeCartulary.ts';
import type { InterfaceLanguage } from '../../../utils/interfaceState.ts';

/**
 * V5 point 1 (2/2, décision D5 (a)) : bandeau d'accès du lecteur unique, composant pur (aucune donnée
 * distante, aucune branche par marque). Il remplace l'aside de démonstration d'`App.tsx` et couvre les
 * trois lectures sans crayon :
 * - `demonstration` : texte inchangé du gabarit (données, documents, valeurs et médias fictifs) ;
 * - `signed-out` : lecture seule, invitation à rouvrir la session propriétaire — les crayons reviennent
 *   sans rechargement dès que la session est rouverte (`onAuthStateChanged` du hook autoritaire) ;
 * - `denied` | `error` | `empty` : lecture seule, le Cartulaire n'a pas pu être chargé depuis le serveur.
 * `idle` | `loading` | `ready` ne rendent rien (décision 1-D3) : aucun texte ne dépend du droit de gérer,
 * donc aucun clignotement pour le propriétaire pendant la résolution des droits (1-2 s).
 */
export function CartularyAccessNotice({ demonstration, status, language }: {
  demonstration: boolean;
  status: AuthoritativeCartularyStatus;
  language: InterfaceLanguage;
}) {
  const tx = (french: string, english: string) => language === 'FR' ? french : english;
  const readOnlyTitle = tx('Lecture seule', 'Read-only');
  const notice = demonstration
    ? {
        icon: <ShieldCheck size={16} aria-hidden="true" />,
        title: tx('Démonstration en lecture seule', 'Read-only demonstration'),
        detail: tx('Gabarit Cartulaire standard · données, documents, valeurs et médias fictifs.', 'Standard Cartulary template · fictional data, documents, values and media.'),
      }
    : status === 'signed-out'
      ? {
          icon: <Eye size={16} aria-hidden="true" />,
          title: readOnlyTitle,
          detail: tx('Connectez-vous avec le compte propriétaire pour modifier ce Cartulaire.', 'Sign in with the owner account to edit this Cartulary.'),
        }
      : status === 'denied' || status === 'error' || status === 'empty'
        ? {
            icon: <Eye size={16} aria-hidden="true" />,
            title: readOnlyTitle,
            detail: tx('Le Cartulaire n’a pas pu être chargé depuis le serveur ; seules les informations disponibles localement sont affichées.', 'The Cartulary could not be loaded from the server; only the information available locally is shown.'),
          }
        : null;
  if (!notice) return null;
  return (
    <aside className="cartulary-access-notice no-print" role="note">
      {notice.icon}
      <strong>{notice.title}</strong>
      <span>{notice.detail}</span>
    </aside>
  );
}
