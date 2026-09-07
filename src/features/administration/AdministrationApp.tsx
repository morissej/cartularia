import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserRoundCog,
  UserX,
  Vault,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { BrandLogo } from '../../components/BrandLogo';
import { observeCartulariaSession, signInToCartularia, signOutOfCartularia } from '../../services/foundations';
import {
  loadAdministrationOverview,
  loadAdministrationUserDashboard,
  updateAdministrationUserState,
  userHasAdministrationRole,
  type AdministrationDatabase,
  type AdministrationDatabaseId,
  type AdministrationOverview,
  type AdministrationUser,
  type AdministrationUserDashboard as UserDashboard,
} from '../../services/administration';
import { AdministrationUserDashboard } from './AdministrationUserDashboard';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import './administration.css';

type AppState = 'checking' | 'signed-out' | 'loading' | 'ready' | 'denied' | 'error';

const DATABASE_ICONS = {
  registry: Database,
  personal: Vault,
  bridge: KeyRound,
};

const DATABASE_DESCRIPTIONS = {
  registry: 'Comptes du Registre, organisations et droits patrimoniaux.',
  personal: 'Comptes du Coffre. Le contenu personnel demeure chiffré et illisible ici.',
  bridge: 'Comptes et références codées, sans identité ni coordonnées personnelles.',
};

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Jamais';

function AdministrationSignIn({ denied = false }: { denied?: boolean }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(denied ? 'Ce compte ne possède pas le rôle administrateur requis.' : null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signInToCartularia(identifier, password);
    } catch {
      setError('Connexion impossible. Vérifiez l’identifiant et le mot de passe administrateur.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="administration-auth">
      <section className="administration-auth__identity">
        <BrandLogo href="/" variant="color" />
        <span className="administration-kicker">Console privée</span>
        <h1>Administration des utilisateurs</h1>
        <p>Une seule interface de contrôle pour les trois bases, sans réunir leurs données.</p>
        <div className="administration-boundaries">
          <span><Database aria-hidden="true" /> Registre</span>
          <span><Vault aria-hidden="true" /> Coffre chiffré</span>
          <span><KeyRound aria-hidden="true" /> Correspondances</span>
        </div>
      </section>
      <section className="administration-auth__panel" aria-labelledby="administration-auth-title">
        <div className="administration-auth__lock"><LockKeyhole aria-hidden="true" /></div>
        <span className="administration-step">Accès restreint</span>
        <h2 id="administration-auth-title">S’identifier</h2>
        <p>Le mot de passe est vérifié par Firebase. Un rôle administrateur serveur distinct est également obligatoire.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="administration-identifier">Identifiant administrateur</label>
          <input id="administration-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required />
          <label htmlFor="administration-password">Mot de passe administrateur</label>
          <input id="administration-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          {error && <p className="administration-error" role="alert"><AlertTriangle aria-hidden="true" />{error}</p>}
          <button type="submit" disabled={submitting || !identifier.trim() || !password}>
            {submitting ? <LoaderCircle className="administration-spinner" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
            {submitting ? 'Vérification…' : 'Ouvrir la console'}
          </button>
        </form>
        <small>La session d’administration exige une reconnexion régulière et n’est jamais accordée par la seule connaissance de l’URL.</small>
      </section>
    </main>
  );
}

function UserStateDialog({
  database,
  user,
  onClose,
  onComplete,
}: {
  database: AdministrationDatabase;
  user: AdministrationUser;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const nextDisabled = !user.disabled;
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeDialog = () => { if (!submitting) onClose(); };
  useDialogFocus(true, dialogRef, closeDialog);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reason.trim().length < 8) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateAdministrationUserState({ database: database.id, uid: user.uid, disabled: nextDisabled, reason });
      await onComplete();
      onClose();
    } catch {
      setError('Le résultat de l’opération n’a pas pu être confirmé. Actualisez l’état du compte avant de recommencer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="administration-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}>
      <section ref={dialogRef} data-focus-layer="true" tabIndex={-1} className="administration-dialog" role="dialog" aria-modal="true" aria-labelledby="administration-dialog-title">
        <span className={`administration-dialog__icon ${nextDisabled ? 'is-danger' : 'is-success'}`}>
          {nextDisabled ? <UserX aria-hidden="true" /> : <UserCheck aria-hidden="true" />}
        </span>
        <span className="administration-step">{database.label}</span>
        <h2 id="administration-dialog-title">{nextDisabled ? 'Suspendre ce compte ?' : 'Réactiver ce compte ?'}</h2>
        <p><strong>{user.label}</strong><br /><span className="administration-mono">{user.uid}</span></p>
        <p>{nextDisabled ? 'La connexion à cette base sera immédiatement bloquée.' : 'La connexion à cette base sera de nouveau autorisée.'} Les autres bases restent inchangées.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="administration-action-reason">Motif obligatoire</label>
          <textarea id="administration-action-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={240} rows={3} placeholder="Décrivez la raison de cette décision…" required />
          {error && <p className="administration-error" role="alert"><AlertTriangle aria-hidden="true" />{error}</p>}
          <div className="administration-dialog__actions">
            <button type="button" className="is-secondary" onClick={closeDialog} disabled={submitting}>Annuler</button>
            <button type="submit" className={nextDisabled ? 'is-danger' : 'is-success'} disabled={submitting || reason.trim().length < 8}>
              {submitting && <LoaderCircle className="administration-spinner" aria-hidden="true" />}
              {submitting ? 'Application…' : nextDisabled ? 'Confirmer la suspension' : 'Confirmer la réactivation'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AdministrationConsole({ overview, onReload }: { overview: AdministrationOverview; onReload: () => Promise<void> }) {
  const [databaseId, setDatabaseId] = useState<AdministrationDatabaseId>('registry');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [reloading, setReloading] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [selectedUser, setSelectedUser] = useState<AdministrationUser | null>(null);
  const [dashboardTarget, setDashboardTarget] = useState<{ database: AdministrationDatabaseId; user: AdministrationUser } | null>(null);
  const [dashboard, setDashboard] = useState<UserDashboard | null>(null);
  const [dashboardState, setDashboardState] = useState<'idle' | 'loading' | 'error'>('idle');
  const database = overview.databases.find((candidate) => candidate.id === databaseId) || overview.databases[0];
  const users = useMemo(() => database.users.filter((user) => {
    const matchesStatus = status === 'all' || (status === 'suspended' ? user.disabled : !user.disabled);
    const needle = query.trim().toLocaleLowerCase('fr');
    return matchesStatus && (!needle || [user.label, user.uid, user.email, user.codedReference]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('fr').includes(needle)));
  }), [database.users, query, status]);

  const refresh = async () => {
    setReloading(true);
    setRefreshError('');
    try { await onReload(); } catch {
      setRefreshError('Actualisation impossible : les données affichées peuvent être périmées. Réessayez ou renouvelez votre connexion administrateur.');
    } finally { setReloading(false); }
  };

  useEffect(() => {
    if (!dashboardTarget) {
      setDashboard(null);
      setDashboardState('idle');
      return;
    }
    let active = true;
    setDashboard(null);
    setDashboardState('loading');
    void loadAdministrationUserDashboard({ database: dashboardTarget.database, uid: dashboardTarget.user.uid })
      .then((result) => {
        if (!active) return;
        setDashboard(result);
        setDashboardState('idle');
      })
      .catch(() => {
        if (active) setDashboardState('error');
      });
    return () => { active = false; };
  }, [dashboardTarget]);

  return (
    <div className="administration-app">
      <header className="administration-topbar" inert={selectedUser ? true : undefined}>
        <BrandLogo href="/administration" />
        <div>
          <span><ShieldCheck aria-hidden="true" /> Session administrateur</span>
          <button type="button" onClick={() => void signOutOfCartularia()}><LogOut aria-hidden="true" /> Se déconnecter</button>
        </div>
      </header>
      {dashboardTarget ? <main className="administration-main" inert={selectedUser ? true : undefined}>
        {dashboardState === 'loading' && <div className="administration-dashboard-state"><LoaderCircle className="administration-spinner" aria-hidden="true" /><h1>Chargement du dashboard</h1><p>Lecture des Cartulaires, Collections, Registres et droits du compte…</p></div>}
        {dashboardState === 'error' && <div className="administration-dashboard-state"><AlertTriangle aria-hidden="true" /><h1>Dashboard indisponible</h1><p>Les données de ce compte n’ont pas pu être réunies.</p><button type="button" onClick={() => setDashboardTarget(null)}>Retour aux utilisateurs</button></div>}
        {dashboard && <AdministrationUserDashboard dashboard={dashboard} onBack={() => setDashboardTarget(null)} />}
      </main> : <main className="administration-main" inert={selectedUser ? true : undefined}>
        <header className="administration-heading">
          <div><span className="administration-kicker">Gouvernance des accès</span><h1>Utilisateurs</h1><p>Contrôlez séparément les comptes de chaque base depuis une vue consolidée.</p></div>
          <button type="button" className="administration-refresh" onClick={() => void refresh()} disabled={reloading}><RefreshCw className={reloading ? 'administration-spinner' : undefined} aria-hidden="true" /> Actualiser</button>
        </header>
        {refreshError && <p className="administration-error" role="alert">{refreshError} <a href="/account/sign-in?returnTo=%2Fadministration">Renouveler la connexion</a></p>}
        <section className="administration-metrics" aria-label="Synthèse des comptes">
          <article><UserRoundCog aria-hidden="true" /><span>Comptes visibles</span><strong>{overview.totals.users}</strong><small>dans les bases configurées</small></article>
          <article><CheckCircle2 aria-hidden="true" /><span>Comptes actifs</span><strong>{overview.totals.users - overview.totals.disabled}</strong><small>connexion autorisée</small></article>
          <article className={overview.totals.disabled ? 'is-attention' : undefined}><UserX aria-hidden="true" /><span>Comptes suspendus</span><strong>{overview.totals.disabled}</strong><small>connexion bloquée</small></article>
          <article><Database aria-hidden="true" /><span>Bases raccordées</span><strong>{overview.totals.configured}/3</strong><small>accès serveur uniquement</small></article>
        </section>
        <nav className="administration-databases" aria-label="Bases de données">
          {overview.databases.map((candidate) => {
            const Icon = DATABASE_ICONS[candidate.id];
            return <button type="button" aria-current={candidate.id === database.id ? 'page' : undefined} onClick={() => { setDatabaseId(candidate.id); setQuery(''); setStatus('all'); }} key={candidate.id}><Icon aria-hidden="true" /><span><strong>{candidate.label}</strong><small>{candidate.state === 'ready' ? `${candidate.users.length} compte${candidate.users.length > 1 ? 's' : ''}` : candidate.state === 'unconfigured' ? 'À configurer' : 'Indisponible'}</small></span></button>;
          })}
        </nav>
        <section className="administration-database-panel">
          <header>
            <div><span className={`administration-database-state is-${database.state}`}>{database.state === 'ready' ? 'Connectée' : database.state === 'unconfigured' ? 'Non configurée' : 'Erreur'}</span><h2>{database.label}</h2><p>{DATABASE_DESCRIPTIONS[database.id]}</p></div>
            {database.truncated && <p className="administration-warning"><AlertTriangle aria-hidden="true" /> Affichage limité aux 200 premiers comptes.</p>}
          </header>
          {database.state !== 'ready' ? (
            <div className="administration-empty"><LockKeyhole aria-hidden="true" /><h3>{database.state === 'unconfigured' ? 'Raccordement à terminer' : 'Base indisponible'}</h3><p>{database.error || 'Le projet Firebase distinct doit être configuré côté serveur et autoriser le compte de service de la console.'}</p></div>
          ) : (
            <>
              <div className="administration-tools">
                <label><Search aria-hidden="true" /><span className="sr-only">Rechercher un compte</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, identifiant ou référence…" /></label>
                <select aria-label="Filtrer par état" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Tous les états</option><option value="active">Actifs</option><option value="suspended">Suspendus</option></select>
              </div>
              <div className="administration-user-list">
                <div className="administration-user-list__head"><span>Utilisateur</span><span>État</span><span>Dernière connexion</span><span>Dossier</span><span>Action</span></div>
                {users.map((user) => <article key={user.uid}>
                  <button type="button" className="administration-user-identity" onClick={() => setDashboardTarget({ database: database.id, user })} aria-label={`Ouvrir le dashboard de ${user.label}`}><span className="administration-user-avatar">{user.label.slice(0, 2).toLocaleUpperCase('fr')}</span><span><strong>{user.label}</strong><small>{user.email || user.codedReference || user.uid}</small></span></button>
                  <span className={`administration-user-status ${user.disabled ? 'is-suspended' : 'is-active'}`}>{user.disabled ? 'Suspendu' : 'Actif'}</span>
                  <span className="administration-user-date">{formatDate(user.lastSignInAt)}</span>
                  <span className={`administration-record-state ${user.recordPresent ? 'is-present' : ''}`}>{user.recordPresent ? <><CheckCircle2 aria-hidden="true" /> Présent</> : 'Absent'}</span>
                  <button type="button" disabled={reloading || !!refreshError} className={user.disabled ? 'is-reactivate' : 'is-suspend'} onClick={() => setSelectedUser(user)}>{user.disabled ? <UserCheck aria-hidden="true" /> : <UserX aria-hidden="true" />}{user.disabled ? 'Réactiver' : 'Suspendre'}</button>
                </article>)}
                {users.length === 0 && <div className="administration-empty administration-empty--compact"><UserRoundCog aria-hidden="true" /><h3>Aucun compte trouvé</h3><p>Modifiez les filtres ou actualisez la base.</p></div>}
              </div>
            </>
          )}
        </section>
        <footer className="administration-safety"><ShieldCheck aria-hidden="true" /><p><strong>Principe de séparation maintenu.</strong> La console peut administrer les accès, mais ne déchiffre pas les données personnelles et ne fusionne pas les trois bases.</p><small>Actualisé le {formatDate(overview.generatedAt)}</small></footer>
      </main>}
      {selectedUser && <UserStateDialog database={database} user={selectedUser} onClose={() => setSelectedUser(null)} onComplete={onReload} />}
    </div>
  );
}

export function AdministrationApp() {
  const [state, setState] = useState<AppState>('checking');
  const [user, setUser] = useState<User | null>(null);
  const [overview, setOverview] = useState<AdministrationOverview | null>(null);

  const reload = async () => {
    setOverview(await loadAdministrationOverview());
  };

  useEffect(() => {
    let revision = 0;
    const unsubscribe = observeCartulariaSession((sessionUser) => {
    const current = ++revision;
    setUser(sessionUser);
    if (!sessionUser) {
      setOverview(null);
      setState('signed-out');
      return;
    }
    setState('loading');
    void userHasAdministrationRole(sessionUser)
      .then(async (allowed) => {
        if (current !== revision) return;
        if (!allowed) {
          setOverview(null);
          setState('denied');
          return;
        }
        const nextOverview = await loadAdministrationOverview();
        if (current !== revision) return;
        setOverview(nextOverview);
        setState('ready');
      })
      .catch(() => { if (current === revision) setState('error'); });
    });
    return () => { revision++; unsubscribe(); };
  }, []);

  if (state === 'denied') return <main className="administration-state"><LockKeyhole aria-hidden="true" /><h1>Accès réservé aux administrateurs</h1><p>Votre session Registre reste ouverte. Ce compte ne possède pas les droits de la console globale.</p><a href="/registry">Revenir au Registre</a><a href="/account/sign-in?returnTo=%2Fadministration">Utiliser un autre compte</a></main>;
  if (state === 'signed-out') return <AdministrationSignIn />;
  if (state === 'error') return <main className="administration-state"><AlertTriangle aria-hidden="true" /><h1>Console indisponible</h1><p>La vérification serveur n’a pas abouti. Renouvelez votre connexion administrateur ou revenez au Registre.</p><a href="/account/sign-in?returnTo=%2Fadministration">Renouveler la connexion</a><a href="/registry">Revenir au Registre</a></main>;
  if (state !== 'ready' || !overview || !user) return <main className="administration-state"><LoaderCircle className="administration-spinner" aria-hidden="true" /><h1>Vérification de l’accès</h1><p>Contrôle du mot de passe, du rôle serveur et des trois connexions…</p></main>;
  return <AdministrationConsole overview={overview} onReload={async () => { await reload(); }} />;
}
