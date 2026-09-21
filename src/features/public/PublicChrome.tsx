import { useEffect, useState } from 'react';
import { Eye, Menu, X } from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo';
import { DEMO_REGISTRY_ENTRY_HREF } from '../registry/registryReturn.ts';
import { DEMO_SUBMARINER_HREF } from './publicContent.ts';

export function PublicHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !menuOpen) return;
      setMenuOpen(false);
      document.querySelector<HTMLButtonElement>('.public-menu-trigger')?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="public-header">
      <BrandLogo href="/" />
      <button
        className="public-menu-trigger"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="public-navigation"
        onClick={() => setMenuOpen((current) => !current)}
      >
        {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        <span className="sr-only">{menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}</span>
      </button>

      <nav id="public-navigation" className={menuOpen ? 'is-open' : ''} aria-label="Navigation principale">
        <a href="/#portes" onClick={closeMenu}>Usages</a>
        <a href="/#livrables" onClick={closeMenu}>Livrables</a>
        <a href="/objets" onClick={closeMenu}>Objets</a>
        <a href="/aide-documentaire" onClick={closeMenu}>Aide photo et vidéo</a>
        <a href="/#faq" onClick={closeMenu}>FAQ</a>
        <a href="/#contact" onClick={closeMenu}>Contact</a>
        {menuOpen && (
          <div className="public-header__mobile-actions">
            <a className="public-link-button" href={DEMO_SUBMARINER_HREF} onClick={closeMenu}>Démo Submariner</a>
            <a className="public-link-button" href={DEMO_REGISTRY_ENTRY_HREF} onClick={closeMenu}>Registre démo · 5 montres</a>
            <a className="public-link-button" href="/account/sign-in" onClick={closeMenu}>Se connecter</a>
            <a className="public-solid-button" href="/account/create" onClick={closeMenu}>Créer un compte</a>
          </div>
        )}
      </nav>

      <div className="public-header__actions">
        <a className="public-text-link" href={DEMO_SUBMARINER_HREF} title="Tester sans inscription">
          <Eye aria-hidden="true" /> Démo
        </a>
        <a className="public-link-button" href="/account/sign-in">Se connecter</a>
        <a className="public-solid-button" href="/account/create">Créer un compte</a>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="public-footer public-footer--compact">
      <div>
        <BrandLogo href="/" variant="inverse" />
        <p>Le dossier vivant de vos objets patrimoniaux.</p>
      </div>
      <div className="public-footer__legal">
        <span>© {new Date().getFullYear()} Cartularia · Tous droits réservés</span>
        <span><a href="/confidentialite">Confidentialité</a> · <a href="/conditions">Conditions d’utilisation</a> · <a href="/accessibilite">Accessibilité</a> · <a href="/service">Disponibilité et limites</a></span>
      </div>
    </footer>
  );
}
