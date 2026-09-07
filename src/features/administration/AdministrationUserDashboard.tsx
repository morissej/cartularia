import {
  ArrowLeft,
  Boxes,
  Building2,
  CheckCircle2,
  Database,
  ExternalLink,
  FolderOpen,
  KeyRound,
  LibraryBig,
  LockKeyhole,
  ShieldCheck,
  UserRound,
  Vault,
} from 'lucide-react';
import { buildCartularyHref } from '../registry/registryCatalog';
import type { AdministrationDatabaseId, AdministrationUserDashboard as Dashboard } from '../../services/administration';

const DATABASE_ICONS = { registry: Database, personal: Vault, bridge: KeyRound };
const label = (value: string) => value
  .replaceAll('_', ' ')
  .replaceAll('-', ' ')
  .replace(/^./, (character) => character.toLocaleUpperCase('fr'));
const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Non renseignée';

function EmptySection({ children }: { children: string }) {
  return <div className="administration-dashboard__empty"><FolderOpen aria-hidden="true" /><p>{children}</p></div>;
}

export function AdministrationUserDashboard({ dashboard, onBack }: {
  dashboard: Dashboard;
  onBack: () => void;
}) {
  const account = dashboard.selectedAccount;
  const registryReturn = dashboard.registries[0]
    ? `/registry/${encodeURIComponent(dashboard.registries[0].id)}/items`
    : '/registry';

  return <section className="administration-dashboard" aria-labelledby="administration-dashboard-title">
    <button type="button" className="administration-dashboard__back" onClick={onBack}>
      <ArrowLeft aria-hidden="true" /> Retour aux utilisateurs
    </button>

    <header className="administration-dashboard__hero">
      <div className="administration-dashboard__avatar"><UserRound aria-hidden="true" /></div>
      <div>
        <span className="administration-kicker">Dashboard du compte</span>
        <h1 id="administration-dashboard-title">{dashboard.profile?.displayName || account.label}</h1>
        <p><span className="administration-mono">{dashboard.registryUid || account.uid}</span></p>
      </div>
      <div className="administration-dashboard__hero-state">
        <span className={`administration-user-status ${account.disabled ? 'is-suspended' : 'is-active'}`}>
          {account.disabled ? 'Suspendu' : 'Actif'}
        </span>
        <small>Dernière connexion<br /><strong>{formatDate(account.lastSignInAt)}</strong></small>
      </div>
    </header>

    <div className="administration-dashboard__metrics" aria-label="Synthèse patrimoniale du compte">
      <article><Boxes aria-hidden="true" /><span>Cartulaires</span><strong>{dashboard.totals.cartularies}</strong><small>{dashboard.totals.drafts} brouillon{dashboard.totals.drafts > 1 ? 's' : ''}</small></article>
      <article><LibraryBig aria-hidden="true" /><span>Collections</span><strong>{dashboard.totals.collections}</strong><small>dans les Registres accessibles</small></article>
      <article><Database aria-hidden="true" /><span>Registres</span><strong>{dashboard.totals.registries}</strong><small>{dashboard.totals.organizations} organisation{dashboard.totals.organizations > 1 ? 's' : ''}</small></article>
      <article><ShieldCheck aria-hidden="true" /><span>Droits accordés</span><strong>{new Set(dashboard.memberships.flatMap((membership) => membership.permissions)).size}</strong><small>{dashboard.memberships.length} rattachement{dashboard.memberships.length > 1 ? 's' : ''}</small></article>
    </div>

    <section className="administration-dashboard__section">
      <header><div><span className="administration-step">Séparation des données</span><h2>Présence dans les trois bases</h2></div><small>Le contenu du Coffre reste chiffré</small></header>
      <div className="administration-dashboard__databases">
        {dashboard.linkedDatabases.map((database) => {
          const Icon = DATABASE_ICONS[database.id as AdministrationDatabaseId];
          return <article key={database.id} className={database.account ? 'is-present' : ''}>
            <Icon aria-hidden="true" />
            <div><strong>{database.label}</strong><small>{database.state === 'error' ? 'Indisponible' : database.account ? 'Compte rattaché' : 'Aucun compte rattaché'}</small></div>
            {database.account && <span className={database.account.disabled ? 'is-suspended' : ''}>{database.account.disabled ? 'Suspendu' : <><CheckCircle2 aria-hidden="true" /> Actif</>}</span>}
          </article>;
        })}
      </div>
    </section>

    <div className="administration-dashboard__columns">
      <section className="administration-dashboard__section administration-dashboard__section--wide">
        <header><div><span className="administration-step">Patrimoine numérique</span><h2>Cartulaires</h2></div><strong>{dashboard.cartularies.length}</strong></header>
        {dashboard.cartularies.length === 0 ? <EmptySection>Aucun Cartulaire détenu par ce compte.</EmptySection> : <div className="administration-dashboard__cartularies">
          {dashboard.cartularies.map((cartulary) => <article key={cartulary.id}>
            <div className="administration-dashboard__asset"><Boxes aria-hidden="true" /><span>{label(cartulary.assetType)}</span></div>
            <div><span className="administration-dashboard__context">{cartulary.makerName || 'Maison non renseignée'} · Révision {cartulary.revision ?? '—'}</span><h3>{cartulary.displayTitle}</h3><p>{cartulary.modelName || cartulary.publicCode || cartulary.id}</p></div>
            <div className="administration-dashboard__cartulary-state"><span>{label(cartulary.lifecycleStatus)}</span><small>{label(cartulary.publicationStatus)}</small></div>
            <a href={buildCartularyHref(cartulary.id, registryReturn, cartulary.assetType)} target="_blank" rel="noreferrer" aria-label={`Ouvrir le Cartulaire ${cartulary.displayTitle}`}><ExternalLink aria-hidden="true" /></a>
          </article>)}
        </div>}
      </section>

      <section className="administration-dashboard__section">
        <header><div><span className="administration-step">Organisation</span><h2>Registres</h2></div><strong>{dashboard.registries.length}</strong></header>
        {dashboard.registries.length === 0 ? <EmptySection>Aucun Registre rattaché.</EmptySection> : <div className="administration-dashboard__simple-list">
          {dashboard.registries.map((registry) => <a href={`/registry/${encodeURIComponent(registry.id)}/overview`} target="_blank" rel="noreferrer" key={registry.id}><Database aria-hidden="true" /><span><strong>{registry.name}</strong><small>{registry.itemCount} objet{registry.itemCount > 1 ? 's' : ''} · {label(registry.status)}</small></span><ExternalLink aria-hidden="true" /></a>)}
        </div>}
      </section>
    </div>

    <section className="administration-dashboard__section">
      <header><div><span className="administration-step">Classement</span><h2>Collections</h2></div><strong>{dashboard.collections.length}</strong></header>
      {dashboard.collections.length === 0 ? <EmptySection>Aucune Collection dans les Registres de ce compte.</EmptySection> : <div className="administration-dashboard__collections">
        {dashboard.collections.map((collection) => <article key={`${collection.registryId}:${collection.id}`}>
          <LibraryBig aria-hidden="true" />
          <div><span className="administration-dashboard__context">{collection.publicationConsent ? 'Publication autorisée' : 'Collection privée'}</span><h3>{collection.name}</h3><p>{collection.description || 'Aucune description.'}</p></div>
          <dl><div><dt>État</dt><dd>{label(collection.status)}</dd></div><div><dt>Visibilité</dt><dd>{label(collection.visibility)}</dd></div><div><dt>Publiés</dt><dd>{collection.publishedItemCount}</dd></div></dl>
          <a href={`/registry/${encodeURIComponent(collection.registryId)}/collections`} target="_blank" rel="noreferrer">Ouvrir <ExternalLink aria-hidden="true" /></a>
        </article>)}
      </div>}
    </section>

    <div className="administration-dashboard__columns">
      <section className="administration-dashboard__section">
        <header><div><span className="administration-step">Accès</span><h2>Rôles et permissions</h2></div><strong>{dashboard.memberships.length}</strong></header>
        {dashboard.memberships.length === 0 ? <EmptySection>Aucun membership Registre trouvé.</EmptySection> : <div className="administration-dashboard__memberships">
          {dashboard.memberships.map((membership) => <article key={membership.organizationId}>
            <Building2 aria-hidden="true" /><div><strong>{dashboard.organizations.find((organization) => organization.id === membership.organizationId)?.name || membership.organizationId}</strong><small>{membership.roles.map(label).join(' · ') || 'Aucun rôle'}</small><div>{membership.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div></div>
          </article>)}
        </div>}
      </section>
      <section className="administration-dashboard__section administration-dashboard__privacy">
        <LockKeyhole aria-hidden="true" />
        <div><span className="administration-step">Limite de confiance</span><h2>Données personnelles protégées</h2><p>Ce dashboard montre les métadonnées de gouvernance, les Cartulaires et les Collections. Il ne reçoit jamais la clé du Coffre et ne peut afficher ni noms civils, ni adresses, ni instructions privées.</p></div>
      </section>
    </div>
  </section>;
}
