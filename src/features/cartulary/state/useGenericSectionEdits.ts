import { useCallback, useState } from 'react';
import type { VerticalSchema } from '../../../schema/schemaTypes.ts';
import { validateGenericFieldValue } from '../../../../scripts/lib/generic-editing-policy.mjs';

export type GenericFieldEdit = { fieldId: string; value: unknown };

/**
 * État d'édition des sections pilotées par le schéma, partagé par tous les lecteurs de Cartulaire.
 * Le hook ne connaît ni la page ni le composant : il ne gère que la saisie, sa validation et l'envoi.
 */
export function useGenericSectionEdits({ schema, onSave, canManage }: {
  schema: VerticalSchema;
  onSave?: (edits: GenericFieldEdit[]) => Promise<void>;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const change = useCallback((next: Record<string, unknown>) => setEdits((current) => ({ ...current, ...next })), []);
  const reset = useCallback(() => { setEdits({}); setEditing(false); setError(''); }, []);
  const clearMessages = useCallback(() => { setError(''); setNotice(''); }, []);

  const save = useCallback(async () => {
    if (!onSave || !canManage || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const values = Object.entries(edits).map(([fieldId, value]) => ({ fieldId, value: validateGenericFieldValue(schema.fields.find((field) => field.fieldId === fieldId), value) }));
      if (!values.length) { setEditing(false); return; }
      await onSave(values);
      setEdits({}); setEditing(false); setNotice('Modifications enregistrées dans le Cartulaire et son Registre.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Enregistrement impossible. Votre saisie est conservée.'); }
    finally { setSaving(false); }
  }, [canManage, edits, onSave, saving, schema.fields]);

  return {
    editing, edits, saving, notice, error,
    hasEdits: Object.keys(edits).length > 0,
    start: () => setEditing(true),
    change, reset, save, clearMessages,
  };
}

export type GenericSectionEdits = ReturnType<typeof useGenericSectionEdits>;
