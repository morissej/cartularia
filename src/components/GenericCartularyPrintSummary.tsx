import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { PrivateCartularySnapshot } from '../services/cartularies';
import type { VerticalSchema } from '../schema/schemaTypes';
import type { Asset } from '../types';
import { buildGenericFieldRows, formatGenericValue } from '../schema/fieldPresentation';
import { schemaSectionLabel } from '../schema/schemaLabels';
import { cartularyPageDefinitions, cartularyPageForSchemaSection } from '../features/cartulary/presentation/cartularyPresentationContract';
import { downloadTextPdf } from '../utils/pdfExport';
import { BrandLogo } from './BrandLogo';

export function GenericCartularyPrintSummary({ snapshot, schema, assets }: { snapshot: PrivateCartularySnapshot; schema: VerticalSchema; assets: Asset[] }) {
  const pages = cartularyPageDefinitions('FR').filter((page) => page.id !== 'publication');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date());
  const blocks = pages.filter((page) => selected.includes(page.id)).map((page) => ({ page, sections: snapshot.sections.filter((section) => cartularyPageForSchemaSection(section.schemaSectionId) === page.id) }));
  const reportLines = blocks.flatMap(({ page, sections }) => [page.label,
    ...sections.flatMap((section) => [schemaSectionLabel(section.schemaSectionId) === section.schemaSectionId ? section.title : schemaSectionLabel(section.schemaSectionId), ...buildGenericFieldRows(section, schema).map((row) => `${row.label} : ${formatGenericValue(row.value)}`)]),
    ...(page.id === 'media' ? assets.map((asset) => `${asset.name} · ${asset.type} · ${asset.capturedAt || 'date non renseignée'}`) : []),
  ]);
  const print = () => {
    if (!confirmed || !blocks.length) return;
    setError(''); setMessage('');
    try {
      const result = downloadTextPdf(`cartularia-${snapshot.envelope.publicCode}-synthese.pdf`, ['SYNTHÈSE PRIVÉE CARTULARIA', snapshot.envelope.displayTitle, snapshot.envelope.publicCode, date, `Révision ${snapshot.envelope.revision} · profil ${schema.schemaId}@${schema.version}`, ...reportLines]);
      setMessage(result === 'print-requested' ? 'Demande d’impression envoyée au navigateur. Choisissez « Enregistrer au format PDF » dans sa boîte de dialogue. Cartularia ne peut pas confirmer l’enregistrement du fichier.' : 'Téléchargement d’une synthèse texte demandé. Vérifiez le fichier dans vos téléchargements.');
    } catch { setError('L’impression n’a pas pu être ouverte. Réessayez.'); }
  };
  return <>
    <section className="generic-section"><h2>Rapport PDF</h2>
      <p>Cette synthèse reprend les informations enregistrées des pages choisies. Les médias sont listés ; les fichiers originaux et les données du Coffre ne sont pas inclus.</p>
      <fieldset><legend>Pages à inclure dans la synthèse privée</legend>{pages.map((page) => <label key={page.id}><input type="checkbox" checked={selected.includes(page.id)} onChange={(event) => { setSelected((current) => event.target.checked ? [...current, page.id] : current.filter((id) => id !== page.id)); setConfirmed(false); setMessage(''); }} />{page.number} · {page.label}</label>)}</fieldset>
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Je confirme que cette synthèse peut contenir les informations privées des pages choisies.</label>
      <p><button type="button" className="button button--primary" disabled={!confirmed || !blocks.length} onClick={print}>Imprimer / Enregistrer en PDF</button></p>
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    </section>
    {createPortal(<div className="report-print-view generic-print-summary" aria-hidden="true">
      <header className="report-print-view__header"><BrandLogo variant="monochrome" decorative /><p>Synthèse privée Cartularia · {snapshot.envelope.publicCode}</p><h1>{snapshot.envelope.displayTitle}</h1><p>{date} · Révision {snapshot.envelope.revision} · Profil {schema.schemaId}@{schema.version}</p></header>
      <section className="report-print-view__integrity"><h2>Portée de la synthèse</h2><p>Les informations ci-dessous sont les déclarations et données enregistrées dans le Cartulaire à cette révision. Ce document ne certifie ni l’authenticité de l’objet, ni la vérité des informations, ni la propriété juridique.</p><p>Tête de chaîne enregistrée : {snapshot.envelope.integrityHead || 'Non renseignée'}</p><p>Les médias sont listés sans leurs fichiers originaux. Les informations du Coffre restent séparées.</p></section>
      {blocks.map(({ page, sections }) => <section className="report-print-view__page-section" key={page.id}><h2>{page.number} · {page.label}</h2>
        {sections.map((section) => <section className="report-print-view__block" key={section.id}><h3>{schemaSectionLabel(section.schemaSectionId) === section.schemaSectionId ? section.title : schemaSectionLabel(section.schemaSectionId)}</h3><dl>{buildGenericFieldRows(section, schema).map((row) => <div key={`${row.source}:${row.fieldId}`}><dt>{row.label}</dt><dd>{formatGenericValue(row.value)}</dd></div>)}</dl></section>)}
        {page.id === 'media' && <ul>{assets.map((asset) => <li key={asset.id}>{asset.name} · {asset.type} · {asset.capturedAt || 'Date non renseignée'}</li>)}</ul>}
        {!sections.length && (page.id !== 'media' || !assets.length) && <p>Aucune information enregistrée pour cette page.</p>}
      </section>)}
      <footer>Cartularia · {snapshot.envelope.publicCode} · Synthèse privée</footer>
    </div>, document.body)}
  </>;
}
