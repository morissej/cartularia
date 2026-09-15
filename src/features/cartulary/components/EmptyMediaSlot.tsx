import { useId, useRef, useState, type ChangeEvent } from 'react';
import { RotateCw, Upload, Video } from 'lucide-react';
import type { MediaSlotKind } from '../media/importMediaFiles.ts';
import type { InterfaceLanguage } from '../../../utils/interfaceState.ts';

/**
 * Emplacement vide de la page Médias (V5 P-D3) : « 02 · Vidéo principale » sans vidéo, « 03 · Séquence 3D »
 * sans séquence. Un contenu absent n'est jamais présenté comme un refus de droit : aucun cadenas, aucun
 * libellé de restriction (contrat V5 P-D3). Composant pur : aucun réseau, aucun état persistant, aucune
 * connaissance du mode démonstration ; structure identique pour tout lecteur, seul le bouton d'ajout dépend de `canEdit`.
 *
 * Le bouton ouvre directement le sélecteur de fichiers du navigateur (input caché) ; les fichiers retenus
 * sont remis à l'appelant, qui les passe au pipeline unique d'import avec le tag imposé par l'emplacement
 * (`MEDIA_SLOT_TAGS`, module `media/importMediaFiles.ts` : seul export de valeur hors composant, pour le
 * rafraîchissement rapide). Le pré-filtre porte sur le MIME déclaré ; la validation réelle (signature du fichier)
 * reste celle du coffre local.
 */

export type { MediaSlotKind };

const SLOT_ACCEPT: Record<MediaSlotKind, string> = {
  'main-video': '.mp4,.m4v,.mov',
  'spin-3d': '.jpg,.jpeg,.png,.webp,.heic,.heif',
};

const SLOT_MIME_PREFIX: Record<MediaSlotKind, string> = { 'main-video': 'video/', 'spin-3d': 'image/' };

export interface EmptyMediaSlotProps {
  slot: MediaSlotKind;
  language: InterfaceLanguage;
  /** Droit d'édition du Cartulaire ; sans lui, texte neutre et aucun bouton. */
  canEdit: boolean;
  /** Import en cours : le bouton est désactivé le temps du pipeline. */
  busy?: boolean;
  /** Reçoit les fichiers conformes choisis ; sans ce rappel, aucun bouton n'est rendu même en édition. */
  onAddFiles?: (files: File[]) => void;
}

export function EmptyMediaSlot({ slot, language, canEdit, busy = false, onAddFiles }: EmptyMediaSlotProps) {
  const tx = (french: string, english: string) => (language === 'FR' ? french : english);
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const isVideo = slot === 'main-video';
  const editable = canEdit && Boolean(onAddFiles);

  const title = isVideo
    ? tx('Aucune vidéo ajoutée', 'No video added')
    : tx('Aucune séquence 3D ajoutée', 'No 3D sequence added');
  const hint = editable
    ? (isVideo
      ? tx('Importez une vidéo courte de l’objet : elle sera classée « Vidéo principale ». L’original reste privé.', 'Import a short video of the object: it will be filed as “Main video”. The original stays private.')
      : tx('Importez au moins deux photos prises en tournant autour de l’objet : elles seront classées « Séquence 3D ».', 'Import at least two photos taken while turning around the object: they will be filed as “3D sequence”.'))
    : (isVideo
      ? tx('Aucune vidéo n’a été ajoutée à ce Cartulaire.', 'No video has been added to this Cartulary.')
      : tx('Aucune séquence 3D n’a été ajoutée à ce Cartulaire.', 'No 3D sequence has been added to this Cartulary.'));
  const buttonLabel = isVideo ? tx('Ajouter une vidéo', 'Add a video') : tx('Ajouter une séquence 3D', 'Add a 3D sequence');
  const rejectionMessage = isVideo
    ? tx('Sélectionnez un fichier vidéo (MP4, MOV).', 'Select a video file (MP4, MOV).')
    : tx('Sélectionnez des photos (JPG, PNG, WEBP, HEIC).', 'Select photos (JPG, PNG, WEBP, HEIC).');

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const accepted = Array.from(input.files ?? []).filter((file) => file.type.startsWith(SLOT_MIME_PREFIX[slot]));
    if (accepted.length > 0) {
      setRejection(null);
      onAddFiles?.(accepted);
    } else if ((input.files?.length ?? 0) > 0) {
      setRejection(rejectionMessage);
    }
    // Permet de choisir à nouveau le même fichier après un refus ou un import.
    input.value = '';
  };

  return (
    <div className="empty-media-slot" data-media-slot={slot} role="group" aria-labelledby={titleId}>
      {isVideo ? <Video size={38} aria-hidden="true" /> : <RotateCw size={38} aria-hidden="true" />}
      <h3 id={titleId}>{title}</h3>
      <p>{hint}</p>
      {editable && (
        <>
          <button type="button" className="button button--quiet" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload size={15} aria-hidden="true" />{buttonLabel}
          </button>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            accept={SLOT_ACCEPT[slot]}
            multiple={!isVideo}
            onChange={handleChange}
          />
          {rejection && <p className="empty-media-slot__error" role="alert">{rejection}</p>}
        </>
      )}
    </div>
  );
}
