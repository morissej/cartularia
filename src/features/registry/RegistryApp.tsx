import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Bell,
  BookOpen,
  Building2,
  ChevronRight,
  Fingerprint,
  Images,
  KeyRound,
  LibraryBig,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo';
import type {
  AccountOrganizationContext,
  MembershipDocument,
  OrganizationDocument,
  RegistryDocument,
} from '../../domain/foundations';
import {
  loadAccountOrganizations,
  observeCartulariaSession,
  signInToCartularia,
  signOutOfCartularia,
} from '../../services/foundations';
import { RegistryItems } from './RegistryItems.tsx';
import { RegistryComparison } from './RegistryComparison.tsx';
import { RegistryAdministration } from './RegistryAdministration.tsx';
import { RegistryAccessCenter } from './RegistryAccessCenter.tsx';
import { RegistryFollowUp } from './RegistryFollowUp.tsx';
import { RegistryGallery } from './RegistryGallery.tsx';
import { RegistryIntegrity } from './RegistryIntegrity.tsx';
import { RegistryOverview } from './RegistryOverview.tsx';
import { ROLE_LABELS } from './registryAdministration.ts';
import {
  parseRegistryRoute,
  registryHref,
  type RegistrySection,
} from './registryRouting.ts';
import './registry.css';

interface RegistryChoice {
  registry: RegistryDocument;
  organization: OrganizationDocument;
  membership: MembershipDocument;
}

const SECTION_META: Array<{
  section: Exclude<RegistrySection, 'compare'>;
  label: string;
  icon: typeof BookOpen;
}> = [
  { section: 'overview', label: "Vue d'ensemble", icon: BookOpen },
  { section: 'items', label: 'Catalogue', icon: LibraryBig },
  { section: 'gallery', label: 'Galerie', icon: Images },
  { section: 'follow-up', label: 'Suivi', icon: Bell },
  { section: 'access', label: 'Accès', icon: KeyRound },
  { section: 'integrity', label: 'Intégrité', icon: Fingerprint },
  { section: 'admin', label: 'Administration', icon: Settings },
];

const flattenRegistryChoices = (contexts: AccountOrganizationContext[]): RegistryChoice[] => {
  const seen = new Set<string>();
  return contexts.flatMap((context) => context.registries.flatMap((registry) => {
    if (seen.has(registry.id)) return [];
    seen.add(registry.id);
    return [{ registry, organization: context.organization, membership: context.membership }];
  }));
};

function RegistryLoading({ message = 'Chargement de votre Registre…' }: { message?: string }) {
  return (
    <main className="registry-state-page" aria-live="polite">
      <LoaderCircle className="registry-spinner" aria-hidden="true" />
      <p>{message}</p>
    </main>
  );
}

function RegistrySignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await signInToCartularia(email.trim(), password);
    } catch {
      setError("Connexion impossible. Vérifiez vos identifiants et réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="registry-auth-page">
      <section className="registry-auth-intro" aria-labelledby="registry-auth-title">
        <a className="registry-auth-logo" href="/" aria-label="Retour à Cartularia">
          <BrandLogo />
        </a>
        <p className="registry-kicker">Espace authentifié</p>
        <h1 id="registry-auth-title">Accéder à votre Registre</h1>
        <p>
          Retrouvez les Cartulaires que vous possédez ou administrez, dans le strict périmètre de vos droits.
        </p>
        <div className="registry-auth-principle">
          <ShieldCheck aria-hidden="true" />
          <span>Les originaux, preuves et archives restent dans chaque Cartulaire.</span>
        </div>
      </section>

      <section className="registry-auth-panel" aria-label="Connexion au Registre">
        <div>
          <span className="registry-step">01</span>
          <h2>Connexion</h2>
          <p>Utilisez le compte auquel vos Registres ont été attribués.</p>
        </div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="registry-email">Adresse électronique</label>
          <input
            id="registry-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="registry-password">Mot de passe</label>
          <input
            id="registry-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="registry-form-error" role="alert">{error}</p>}
          <button type="submit" disabled={submitting || !email.trim() || !password}>
            {submitting ? <LoaderCircle className="registry-spinner" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
            {submitting ? 'Connexion…' : 'Ouvrir le Registre'}
          </button>
        </form>
      </section>
    </main>
  );
}

function RegistryChooser({ choices, user }: { choices: RegistryChoice[]; user: User }) {
  const handleSignOut = async () => {
    await signOutOfCartularia();
  };

  return (
    <div className="registry-app">
      <header className="registry-topbar registry-topbar--chooser">
        <a href="/" className="registry-brand" aria-label="Retour à Cartularia"><BrandLogo /></a>
        <button type="button" className="registry-signout" onClick={handleSignOut}>
          <LogOut aria-hidden="true" /> Déconnexion
        </button>
      </header>
      <main className="registry-chooser">
        <div className="registry-chooser__intro">
          <p className="registry-kicker">Registre</p>
          <h1>Choisir un contexte</h1>
          <p>{user.displayName || user.email || 'Compte Cartularia'}, vos droits donnent accès aux Registres suivants.</p>
        </div>
        <div className="registry-choice-grid">
          {choices.map(({ registry, organization, membership }) => (
            <a className="registry-choice" href={registryHref(registry.id)} key={registry.id}>
              <div className="registry-choice__icon"><Building2 aria-hidden="true" /></div>
              <div>
                <span>{organization.name}</span>
                <h2>{registry.name}</h2>
                <p>{registry.description || 'Registre privé Cartularia'}</p>
                <small>{membership.roles.map((role) => ROLE_LABELS[role] || role).join(' · ')}</small>
              </div>
              <div className="registry-choice__count">
                <strong>{registry.itemCount}</strong>
                <span>Cartulaire{registry.itemCount > 1 ? 's' : ''}</span>
              </div>
              <ChevronRight className="registry-choice__arrow" aria-hidden="true" />
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}

function RegistryNoAccess({ user }: { user: User }) {
  return (
    <main className="registry-state-page registry-state-page--empty">
      <LockKeyhole aria-hidden="true" />
      <p className="registry-kicker">Aucun Registre</p>
      <h1>Aucun contexte ne vous est attribué</h1>
      <p>Votre compte est authentifié, mais aucun membership actif ne lui donne actuellement accès à un Registre.</p>
      <div className="registry-state-actions">
        <span>{user.email}</span>
        <button type="button" onClick={() => signOutOfCartularia()}>Changer de compte</button>
      </div>
    </main>
  );
}

function RegistryShell({ choice, choices, section, user }: {
  choice: RegistryChoice;
  choices: RegistryChoice[];
  section: RegistrySection;
  user: User;
}) {
  const { registry, organization } = choice;
  const handleRegistryChange = (registryId: string) => {
    window.location.assign(registryHref(registryId));
  };

  return (
    <div className="registry-app">
      <a className="registry-skip-link" href="#registry-main-content">Aller au contenu principal</a>
      <header className="registry-topbar">
        <a href="/" className="registry-brand" aria-label="Retour à Cartularia"><BrandLogo /></a>
        <div className="registry-product-label">
          <span>Registre</span>
          <strong>{registry.name}</strong>
        </div>
        <div className="registry-account-controls">
          {choices.length > 1 && (
            <label className="registry-context-select">
              <span>Contexte</span>
              <select value={registry.id} onChange={(event) => handleRegistryChange(event.target.value)}>
                {choices.map((candidate) => (
                  <option value={candidate.registry.id} key={candidate.registry.id}>
                    {candidate.registry.name} — {candidate.organization.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="registry-user">
            <UserRound aria-hidden="true" />
            <span><strong>{user.displayName || 'Compte Cartularia'}</strong><small>{user.email}</small></span>
          </div>
          <button type="button" className="registry-signout registry-signout--icon" onClick={() => signOutOfCartularia()} aria-label="Se déconnecter">
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="registry-layout">
        <aside className="registry-sidebar">
          <div className="registry-sidebar__context">
            <Building2 aria-hidden="true" />
            <span><small>Administré dans</small><strong>{organization.name}</strong></span>
          </div>
          <nav aria-label="Navigation du Registre">
            {SECTION_META.map((meta) => {
              const target = meta.section;
              const Icon = meta.icon;
              const current = section === target || (section === 'compare' && target === 'items');
              return (
                <a
                  href={registryHref(registry.id, target)}
                  aria-current={current ? 'page' : undefined}
                  aria-label={meta.label}
                  key={target}
                >
                  <Icon aria-hidden="true" />
                  <span>{meta.label}</span>
                </a>
              );
            })}
          </nav>
          <div className="registry-sidebar__security">
            <ShieldCheck aria-hidden="true" />
            <span>Secret par défaut</span>
          </div>
        </aside>

        <main className="registry-main" id="registry-main-content" tabIndex={-1}>
          {section === 'overview' && (
            <RegistryOverview registry={registry} organization={organization} membership={choice.membership} />
          )}
          {section === 'items' && <RegistryItems registry={registry} />}
          {section === 'gallery' && (
            <RegistryGallery
              registry={registry}
              canReadCartularies={choice.membership.permissions.includes('cartulary.read')}
            />
          )}
          {section === 'compare' && <RegistryComparison registry={registry} />}
          {section === 'follow-up' && (
            <RegistryFollowUp
              registry={registry}
              canReadCartularies={choice.membership.permissions.includes('cartulary.read')}
            />
          )}
          {section === 'access' && (
            <RegistryAccessCenter
              registry={registry}
              canReadAccesses={choice.membership.permissions.includes('access.read')}
            />
          )}
          {section === 'integrity' && (
            <RegistryIntegrity
              registry={registry}
              canReadCartularies={choice.membership.permissions.includes('cartulary.read')}
            />
          )}
          {section === 'admin' && (
            <RegistryAdministration
              registry={registry}
              organization={organization}
              membership={choice.membership}
              organizationRegistries={choices
                .filter((candidate) => candidate.organization.id === organization.id)
                .map((candidate) => candidate.registry)}
              currentUid={user.uid}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export function RegistryApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [contexts, setContexts] = useState<AccountOrganizationContext[]>([]);
  const [loadingContexts, setLoadingContexts] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const route = useMemo(() => parseRegistryRoute(window.location.pathname), []);
  const choices = useMemo(() => flattenRegistryChoices(contexts), [contexts]);

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = 'Registre · Cartularia';
    if (description) {
      description.content = 'Le Registre privé Cartularia réunit les Cartulaires accessibles à votre compte.';
    }
    return () => {
      document.title = previousTitle;
      if (description && previousDescription !== undefined) description.content = previousDescription;
    };
  }, []);

  useEffect(() => observeCartulariaSession(setUser), []);

  useEffect(() => {
    if (!user) {
      setContexts([]);
      setLoadingContexts(false);
      setContextError(null);
      return;
    }
    let active = true;
    setLoadingContexts(true);
    setContextError(null);
    loadAccountOrganizations(user)
      .then((nextContexts) => {
        if (active) setContexts(nextContexts);
      })
      .catch(() => {
        if (active) {
          setContexts([]);
          setContextError("Impossible de charger les Registres autorisés. Réessayez ou contactez l’assistance.");
        }
      })
      .finally(() => {
        if (active) setLoadingContexts(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user || loadingContexts || contextError || route.registryId || choices.length !== 1) return;
    window.location.replace(registryHref(choices[0].registry.id));
  }, [choices, contextError, loadingContexts, route.registryId, user]);

  if (user === undefined) return <RegistryLoading message="Vérification de la session…" />;
  if (!user) return <RegistrySignIn />;
  if (loadingContexts) return <RegistryLoading />;
  if (contextError) {
    return (
      <main className="registry-state-page registry-state-page--error">
        <LockKeyhole aria-hidden="true" />
        <h1>Registre indisponible</h1>
        <p role="alert">{contextError}</p>
        <button type="button" onClick={() => window.location.reload()}>Réessayer</button>
      </main>
    );
  }
  if (choices.length === 0) return <RegistryNoAccess user={user} />;
  if (!route.registryId) return choices.length === 1 ? <RegistryLoading message="Ouverture du Registre…" /> : <RegistryChooser choices={choices} user={user} />;

  const selectedChoice = choices.find(({ registry }) => registry.id === route.registryId);
  if (!selectedChoice) {
    return (
      <main className="registry-state-page registry-state-page--error">
        <LockKeyhole aria-hidden="true" />
        <h1>Contexte non autorisé</h1>
        <p>Ce Registre n’est pas accessible avec le compte actuellement connecté.</p>
        <a href="/registry">Choisir un autre Registre</a>
      </main>
    );
  }

  return <RegistryShell choice={selectedChoice} choices={choices} section={route.section} user={user} />;
}
